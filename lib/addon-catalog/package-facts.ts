import { parse } from 'yaml'

import type { AddonPackageRef } from './listing'
import { resolvePinnedCommit } from './package-source'



const API = 'https://gitlab.com/api/v4/projects'

export interface AddonPackageFacts {
    parts: string[]
    /** Keycloak roles the add-on defines — the permission surface an operator reviews. */
    ssoRoles: string[]
    hasSso: boolean
    images: { name: string; repository: string; tag?: string }[]
    charts: { name: string; chart: string; version?: string }[]
}

const EMPTY: AddonPackageFacts = { parts: [], ssoRoles: [], hasSso: false, images: [], charts: [] }

/**
 * Cached forever per project+ref: the ref is immutable by catalogue rule, so
 * the answer cannot change. Only a re-pinned catalogue entry produces a new key.
 */
const cache = new Map<string, AddonPackageFacts>()

type Node = Record<string, unknown>

const isNode = (value: unknown): value is Node =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

async function readYaml(ref: AddonPackageRef, file: string): Promise<unknown> {
    const path = ref.path === '.' ? file : `${ref.path.replace(/\/+$/, '')}/${file}`
    const url =
        `${API}/${encodeURIComponent(ref.project)}/repository/files/` +
        `${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref.ref)}`

    try {
        const response = await fetch(url, { cache: 'no-store' })
        if (!response.ok) return undefined
        return parse(await response.text())
    } catch {
        // A package that cannot be read costs the page a section, nothing more.
        return undefined
    }
}

function readParts(doc: unknown): string[] {
    if (!isNode(doc) || !Array.isArray(doc.parts)) return []
    return doc.parts
        .map((part) => (isNode(part) && typeof part.name === 'string' ? part.name : undefined))
        .filter((name): name is string => Boolean(name))
}

function readSsoRoles(doc: unknown): string[] {
    if (!isNode(doc)) return []
    const roles: string[] = []
    for (const client of Object.values(doc)) {
        if (!isNode(client) || !Array.isArray(client.roles)) continue
        for (const role of client.roles) {
            if (isNode(role) && typeof role.name === 'string') roles.push(role.name)
        }
    }
    return roles
}

/** images.yaml and charts.yaml nest one or two levels deep — walk both shapes. */
function readNested<T>(doc: unknown, pick: (name: string, node: Node) => T | undefined): T[] {
    if (!isNode(doc)) return []
    const found: T[] = []

    for (const [key, value] of Object.entries(doc)) {
        if (!isNode(value)) continue
        const direct = pick(key, value)
        if (direct) {
            found.push(direct)
            continue
        }
        for (const [childKey, childValue] of Object.entries(value)) {
            if (!isNode(childValue)) continue
            const nested = pick(childKey, childValue)
            if (nested) found.push(nested)
        }
    }

    return found
}

export async function fetchAddonPackageFacts(ref: AddonPackageRef): Promise<AddonPackageFacts> {
    const key = `${ref.project}@${ref.ref}:${ref.path}`
    const cached = cache.get(key)
    if (cached) return cached

    // Best-effort, unlike the install path's fail-closed pin: an unresolvable
    // ref costs the page its facts section (uncached — the next view retries).
    // It never falls back to reading at the raw, possibly mutable ref: facts
    // that disagree with what an install would vendor are worse than no facts.
    const commit = await resolvePinnedCommit(ref).catch(() => null)
    if (!commit) return EMPTY
    const pinned: AddonPackageRef = { ...ref, ref: commit }

    const [component, keycloak, images, charts] = await Promise.all([
        readYaml(pinned, 'civitas-component.yaml'),
        readYaml(pinned, 'keycloak-clients.yaml'),
        readYaml(pinned, 'images.yaml'),
        readYaml(pinned, 'charts.yaml'),
    ])

    const facts: AddonPackageFacts = {
        parts: readParts(component),
        ssoRoles: readSsoRoles(keycloak),
        hasSso: keycloak !== undefined,
        images: readNested(images, (name, node) =>
            typeof node.repository === 'string'
                ? {
                      name,
                      repository: node.repository,
                      tag: node.tag === undefined ? undefined : String(node.tag),
                  }
                : undefined,
        ),
        charts: readNested(charts, (name, node) =>
            typeof node.chart === 'string'
                ? {
                      name,
                      chart: node.chart,
                      version: node.version === undefined ? undefined : String(node.version),
                  }
                : undefined,
        ),
    }

    cache.set(key, facts)
    return facts
}

export const NO_PACKAGE_FACTS = EMPTY
