import { exportMetadataSchema, type ExportMetadata } from '@/lib/export/metadata'
import { catalogEntryPath, matchesEntryPath } from '@/lib/use-case-catalog/path'

/**
 * The catalogue side of an export: the v3 repo-list row for the package, and
 * the edit that places it in `index.json`.
 *
 * Pure functions on strings, so the interesting part (touching someone else's
 * index without disturbing the rest of it) is testable without a network.
 */

export interface CatalogEntryInput {
    metadata?: ExportMetadata
    id: string
    displayName: string
    description: string
    version: string
    maintainer: string
    license: string
    keywords: string[]
    /** Target repository web URL. */
    repoUrl: string
    /** Package directory inside the repository; '.' for the root. */
    path: string
    /** The commit the package was verified at — the pin. */
    commitSha: string
}

/**
 * The catalogue input for a package as it was merged, read from its manifest.
 * The export writes the whole profile there, so the entry needs no form, and
 * it lists exactly what the bundle review saw. A string names what is wrong.
 */
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
    return {
        id: text('id') as string,
        displayName: text('displayName') as string,
        description: text('description') as string,
        version: text('version') as string,
        maintainer: text('maintainer') as string,
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
    | { status: 'added'; content: string; indexVersion: string }
    | { status: 'replaced'; content: string; indexVersion: string; previousVersion?: string }
    | { status: 'unchanged'; indexVersion: string }

function bumpPatch(version: unknown): string {
    if (typeof version !== 'string') return '3.0.1'
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
    if (!match) return version
    return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

/**
 * Adds the row to `useCases` (or replaces the row with the same id — a new
 * version of an already listed package). Bumps the index's own content
 * version and stamps `updatedAt`, as CONTRIBUTING asks every merge request
 * to. The rest of the file is re-serialised with the repository's two-space
 * style so the diff shows the one row and the two header fields, nothing else.
 */
export function applyCatalogEntry(
    indexJson: string,
    entry: Record<string, unknown>,
    now: Date = new Date(),
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
    const carriedOver = existing
        ? Object.fromEntries(
              Object.entries(existing).filter(
                  ([key]) => key !== 'curation' && !EXPORT_OWNED_KEYS.has(key),
              ),
          )
        : {}
    const merged = { ...entry, ...carriedOver, ...keptReleaseTag(existing, entry) }

    if (existing && canonical(withoutCuration(existing)) === canonical(merged)) {
        return { status: 'unchanged', indexVersion: String(index.version ?? '') }
    }

    const next = existingAt >= 0 ? useCases.map((row, i) => (i === existingAt ? merged : row)) : [...useCases, merged]
    const indexVersion = bumpPatch(index.version)
    const updated = {
        ...index,
        version: indexVersion,
        updatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        useCases: next,
    }
    const content = `${JSON.stringify(updated, null, 2)}\n`
    if (existingAt >= 0) {
        const previous = useCases[existingAt].version
        return {
            status: 'replaced',
            content,
            indexVersion,
            previousVersion: typeof previous === 'string' ? previous : undefined,
        }
    }
    return { status: 'added', content, indexVersion }
}

const EXPORT_OWNED_KEYS: ReadonlySet<string> = new Set([
    'id',
    'type',
    'displayName',
    'description',
    'version',
    'maintainer',
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

function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
    if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
    return JSON.stringify(value)
}
