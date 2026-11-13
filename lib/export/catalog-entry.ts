import { organisationCodeSchema, organisationSchema } from '@/lib/catalog/schema'
import type { Organisation } from '@/lib/catalog/types'
import { exportMetadataSchema, METADATA_GROUPS, type ExportMetadata } from '@/lib/export/metadata'
import { catalogEntryPath, matchesEntryPath } from '@/lib/use-case-catalog/path'

export interface CatalogEntryInput {
    metadata?: ExportMetadata
    id: string
    displayName: string
    description: string
    version: string
    maintainer: string
    maintainerOrg?: string
    /** Proposed with the package, for the catalogue's list. */
    organisations?: Organisation[]
    license: string
    keywords: string[]
    repoUrl: string
    /** '.' for the repository root. */
    path: string
    /** The pin: the commit the package was verified at. */
    commitSha: string
}

/** From the merged manifest, so the entry lists exactly what the review saw; a string is the error. */
export function catalogInputFromManifest(
    raw: string,
    location: Pick<CatalogEntryInput, 'repoUrl' | 'path' | 'commitSha'>,
): CatalogEntryInput | string {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return 'manifest.json ist kein gültiges JSON.'
    }
    const manifest = asRecord(parsed)
    if (!manifest) return 'manifest.json ist kein Objekt.'

    const text = (key: string): string | undefined => {
        const value = manifest[key]
        return typeof value === 'string' && value.trim() ? value : undefined
    }
    const required = ['id', 'displayName', 'description', 'version', 'maintainer', 'license'] as const
    const missing = required.filter((key) => !text(key))
    if (missing.length) return `manifest.json nennt kein ${missing.join(', ')}.`

    const picked = Object.fromEntries(
        Object.keys(exportMetadataSchema.shape)
            .filter((key) => key in manifest)
            .map((key) => [key, manifest[key]]),
    )
    const metadata = exportMetadataSchema.safeParse(picked)
    if (!metadata.success) {
        return `Der Steckbrief im Manifest ist ungültig: ${metadata.error.issues.map((issue) => issue.message).join('; ')}`
    }
    const maintainerOrg = organisationCodeSchema.safeParse(manifest.maintainerOrg)
    const organisations = Array.isArray(manifest.organisations)
        ? manifest.organisations.flatMap((row) => {
              const parsed = organisationSchema.safeParse(row)
              return parsed.success ? [parsed.data] : []
          })
        : []
    return {
        id: text('id') as string,
        displayName: text('displayName') as string,
        description: text('description') as string,
        version: text('version') as string,
        maintainer: text('maintainer') as string,
        ...(maintainerOrg.success ? { maintainerOrg: maintainerOrg.data } : {}),
        ...(organisations.length ? { organisations } : {}),
        license: text('license') as string,
        keywords: Array.isArray(manifest.keywords)
            ? manifest.keywords.filter((keyword): keyword is string => typeof keyword === 'string')
            : [],
        metadata: metadata.data,
        ...location,
    }
}

export function buildCatalogEntry(input: CatalogEntryInput): Record<string, unknown> {
    const { themes, ...described } = exportMetadataSchema.parse(input.metadata ?? {})
    return {
        id: input.id,
        type: 'usecase',
        displayName: input.displayName,
        description: input.description,
        version: input.version,
        maintainer: input.maintainer,
        ...(input.maintainerOrg ? { maintainerOrg: input.maintainerOrg } : {}),
        license: input.license,
        keywords: input.keywords,
        ...(themes ? { themes } : {}),
        deploymentRef: {
            url: input.repoUrl,
            ref: input.commitSha.toLowerCase(),
            releaseTag: null,
            path: input.path,
        },
        ...described,
    }
}

export type CatalogEdit =
    | { status: 'conflict'; indexVersion: string; conflictingId: string }
    | { status: 'withdrawn'; indexVersion: string; reason?: string }
    | { status: 'added'; content: string; indexVersion: string; organisations: Organisation[]; taken: TakenCode[] }
    | { status: 'replaced'; content: string; indexVersion: string; previousVersion?: string; organisations: Organisation[]; taken: TakenCode[] }
    | { status: 'unchanged'; indexVersion: string }

/** A proposed organisation whose code the list gave to another one meanwhile; the entry names it as text only. */
export interface TakenCode {
    proposed: Organisation
    listedAs: string
}

export type EntryTexts = Pick<CatalogEntryInput, 'displayName' | 'description' | 'keywords'> & { metadata: ExportMetadata }

export type TextEdit =
    | { status: 'not-listed' }
    | { status: 'unchanged' }
    | { status: 'changed'; content: string; indexVersion: string }

function bumpPatch(version: unknown): string {
    if (typeof version !== 'string') return '3.0.1'
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
    if (!match) return version
    return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

/** Bumps `version` and `updatedAt` as CONTRIBUTING asks; two-space JSON keeps the diff to the row. */
export function applyCatalogEntry(
    indexJson: string,
    entry: Record<string, unknown>,
    now: Date = new Date(),
    organisations: readonly Organisation[] = [],
): CatalogEdit {
    const index = JSON.parse(indexJson) as Record<string, unknown>
    const useCases = Array.isArray(index.useCases) ? (index.useCases as Record<string, unknown>[]) : []
    const existingAt = useCases.findIndex((row) => row.id === entry.id)

    const tombstone = useCases.find((row) => row.id === entry.id && row.revoked)
    if (tombstone) {
        return {
            status: 'withdrawn',
            indexVersion: String(index.version ?? ''),
            reason:
                typeof tombstone.revokedReason === 'string' ? tombstone.revokedReason : undefined,
        }
    }

    const address = catalogEntryPath(String(entry.id))
    const collision = useCases.find(
        (row) =>
            row.id !== entry.id &&
            !row.revoked &&
            matchesEntryPath(String(row.id), address.publisher, address.slug),
    )
    if (collision) {
        return {
            status: 'conflict',
            indexVersion: String(index.version ?? ''),
            conflictingId: String(collision.id),
        }
    }

    const existing = existingAt >= 0 ? useCases[existingAt] : undefined
    const listed = Array.isArray(index.organisations) ? (index.organisations as Record<string, unknown>[]) : []
    const listedName = (code: string) => listed.find((row) => row.id === code)?.name
    const fresh = organisations.filter((organisation) => listedName(organisation.id) === undefined)
    const taken = organisations.flatMap((proposed) => {
        const listedAs = listedName(proposed.id)
        return typeof listedAs === 'string' && listedAs !== proposed.name ? [{ proposed, listedAs }] : []
    })
    const names = new Map<unknown, unknown>([...listed.map((row) => [row.id, row.name] as const), ...fresh.map((row) => [row.id, row.name] as const)])
    entry = linkedOnly(withKeptLinks(entry, existing), names)
    // Only what the entry links to: the list holds no organisation without an entry.
    const used = new Set([entry.maintainerOrg, asRecord(entry.implementation)?.operatorOrg])
    const added = fresh.filter((organisation) => used.has(organisation.id))
    const carriedOver = existing
        ? Object.fromEntries(
              Object.entries(existing).filter(
                  ([key]) => key !== 'curation' && !EXPORT_OWNED_KEYS.has(key),
              ),
          )
        : {}
    const merged = { ...entry, ...carriedOver, ...keptReleaseTag(existing, entry) }

    if (existing && !added.length && canonical(withoutCuration(existing)) === canonical(merged)) {
        return { status: 'unchanged', indexVersion: String(index.version ?? '') }
    }

    const next = existingAt >= 0 ? useCases.map((row, i) => (i === existingAt ? merged : row)) : [...useCases, merged]
    const { content, indexVersion } = rewrittenIndex(added.length ? { ...index, organisations: [...listed, ...added] } : index, next, now)
    if (existingAt >= 0) {
        const previous = useCases[existingAt].version
        return {
            status: 'replaced',
            content,
            indexVersion,
            previousVersion: typeof previous === 'string' ? previous : undefined,
            organisations: added,
            taken,
        }
    }
    return { status: 'added', content, indexVersion, organisations: added, taken }
}

/** A package shared before it knew the codes keeps the row's links, as long as the names stay. */
function withKeptLinks(entry: Record<string, unknown>, existing: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!existing) return entry
    const kept = { ...entry }
    if (!kept.maintainerOrg && existing.maintainerOrg && existing.maintainer === kept.maintainer) kept.maintainerOrg = existing.maintainerOrg
    const before = asRecord(existing.implementation)
    const after = asRecord(kept.implementation)
    if (after && !after.operatorOrg && before?.operatorOrg && before.operator === after.operator) {
        kept.implementation = { ...after, operatorOrg: before.operatorOrg }
    }
    return kept
}

/**
 * Only the links the catalogue's CI accepts: a listed code whose name is the text beside it
 * (the lead may add a department). Any other link goes, and the name stays as text.
 */
function linkedOnly(entry: Record<string, unknown>, names: ReadonlyMap<unknown, unknown>): Record<string, unknown> {
    const linked = { ...entry }
    const nameOf = (code: unknown) => {
        const name = names.get(code)
        return typeof name === 'string' ? name : undefined
    }
    if (linked.maintainerOrg !== undefined && nameOf(linked.maintainerOrg) !== linked.maintainer) delete linked.maintainerOrg
    const implementation = asRecord(linked.implementation)
    const lead = nameOf(implementation?.operatorOrg)
    if (implementation?.operatorOrg !== undefined && !(lead && typeof implementation.operator === 'string' && implementation.operator.startsWith(lead))) {
        const unlinked = { ...implementation }
        delete unlinked.operatorOrg
        linked.implementation = unlinked
    }
    return linked
}

const TEXT_PATHS = ['displayName', 'description', 'keywords', 'themes', 'media', ...METADATA_GROUPS.flatMap((group) => group.fields.map((field) => field.path))]
const holdsTexts = (path: string) => TEXT_PATHS.some((owned) => owned === path || owned.startsWith(`${path}.`))

function textsOverRow(row: Record<string, unknown>, texts: Record<string, unknown>, path = ''): Record<string, unknown> {
    const kept = Object.entries(row).flatMap(([key, value]): [string, unknown][] => {
        const at = path ? `${path}.${key}` : key
        if (!holdsTexts(at)) return [[key, value]]
        if (!(key in texts)) return []
        const [before, after] = [asRecord(value), asRecord(texts[key])]
        return [[key, before && after ? textsOverRow(before, after, at) : texts[key]]]
    })
    return Object.fromEntries([...kept, ...Object.entries(texts).filter(([key]) => !(key in row))])
}

export function applyTextEdit(
    indexJson: string,
    id: string,
    version: string,
    { metadata, ...basics }: EntryTexts,
    now: Date = new Date(),
): TextEdit {
    const index = JSON.parse(indexJson) as Record<string, unknown>
    const useCases = Array.isArray(index.useCases) ? (index.useCases as Record<string, unknown>[]) : []
    const at = useCases.findIndex((row) => row.id === id && row.version === version && !row.revoked)
    if (at < 0) return { status: 'not-listed' }

    const edited = textsOverRow(useCases[at], { ...basics, ...metadata })
    if (canonical(useCases[at]) === canonical(edited)) return { status: 'unchanged' }

    return { status: 'changed', ...rewrittenIndex(index, useCases.map((row, i) => (i === at ? edited : row)), now) }
}

function rewrittenIndex(index: Record<string, unknown>, useCases: Record<string, unknown>[], now: Date): { content: string; indexVersion: string } {
    const indexVersion = bumpPatch(index.version)
    const updated = {
        ...index,
        version: indexVersion,
        updatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        useCases,
    }
    return { content: `${JSON.stringify(updated, null, 2)}\n`, indexVersion }
}

const EXPORT_OWNED_KEYS: ReadonlySet<string> = new Set([
    'id',
    'type',
    'displayName',
    'description',
    'version',
    'maintainer',
    'maintainerOrg',
    'license',
    'keywords',
    'deploymentRef',
    ...Object.keys(exportMetadataSchema.shape),
])

function keptReleaseTag(
    existing: Record<string, unknown> | undefined,
    entry: Record<string, unknown>,
): { deploymentRef?: Record<string, unknown> } {
    const before = asRecord(existing?.deploymentRef)
    const after = asRecord(entry.deploymentRef)
    if (!before || !after) return {}
    if (before.ref !== after.ref || typeof before.releaseTag !== 'string') return {}
    return { deploymentRef: { ...after, releaseTag: before.releaseTag } }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined
}

function withoutCuration(row: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'curation'))
}

export function isListed(indexJson: string, id: string, version: string): boolean {
    try {
        const index = JSON.parse(indexJson) as {
            useCases?: { id?: unknown; version?: unknown; revoked?: unknown }[]
        }
        return (index.useCases ?? []).some(
            (row) => row.id === id && row.version === version && !row.revoked,
        )
    } catch {
        return false
    }
}

export function listedRowOf(indexJson: string, id: string, version: string): string | undefined {
    try {
        const index = JSON.parse(indexJson) as { useCases?: { id?: unknown; version?: unknown; revoked?: unknown }[] }
        const row = index.useCases?.find((candidate) => candidate.id === id && candidate.version === version && !candidate.revoked)
        return row ? JSON.stringify(row) : undefined
    } catch {
        return undefined
    }
}

export function maintainerOf(indexJson: string, id: string): string | undefined {
    try {
        const index = JSON.parse(indexJson) as { useCases?: unknown }
        const rows = Array.isArray(index.useCases) ? (index.useCases as Record<string, unknown>[]) : []
        const maintainer = rows.find((candidate) => candidate?.id === id)?.maintainer
        return typeof maintainer === 'string' && maintainer.trim() ? maintainer.trim() : undefined
    } catch {
        return undefined
    }
}

export interface IndexRow {
    version?: string
    revoked: boolean
    reason?: string
}

/** undefined: no row for `id`; null: the index is no JSON, so nobody can tell. */
export function indexRowOf(indexJson: string, id: string): IndexRow | undefined | null {
    let index: { useCases?: unknown }
    try {
        index = JSON.parse(indexJson) as { useCases?: unknown }
    } catch {
        return null
    }
    const rows = Array.isArray(index.useCases) ? (index.useCases as Record<string, unknown>[]) : []
    const row = rows.find((candidate) => candidate?.id === id)
    if (!row) return undefined
    return {
        ...(typeof row.version === 'string' ? { version: row.version } : {}),
        revoked: Boolean(row.revoked),
        ...(typeof row.revokedReason === 'string' && row.revokedReason.trim() ? { reason: row.revokedReason.trim() } : {}),
    }
}

function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
    if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
    return JSON.stringify(value)
}
