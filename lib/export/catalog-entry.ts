/**
 * The catalogue side of an export: the v3 repo-list row for the package, and
 * the edit that places it in `index.json`.
 *
 * Pure functions on strings, so the interesting part (touching someone else's
 * index without disturbing the rest of it) is testable without a network.
 */

export interface CatalogEntryInput {
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

export function buildCatalogEntry(input: CatalogEntryInput): Record<string, unknown> {
    return {
        id: input.id,
        type: 'usecase',
        displayName: input.displayName,
        description: input.description,
        version: input.version,
        maintainer: input.maintainer,
        license: input.license,
        keywords: input.keywords,
        deploymentRef: {
            url: input.repoUrl,
            ref: input.commitSha.toLowerCase(),
            releaseTag: null,
            path: input.path,
        },
    }
}

export type CatalogEdit =
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

    if (existingAt >= 0) {
        const existing = useCases[existingAt]
        const existingRef = existing.deploymentRef as Record<string, unknown> | undefined
        const entryRef = entry.deploymentRef as Record<string, unknown>
        if (existing.version === entry.version && existingRef?.ref === entryRef.ref) {
            return { status: 'unchanged', indexVersion: String(index.version ?? '') }
        }
    }

    const next = existingAt >= 0 ? useCases.map((row, i) => (i === existingAt ? entry : row)) : [...useCases, entry]
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

/** True when the index already lists this id at this version — the "already listed" state of the status panel. */
export function isListed(indexJson: string, id: string, version: string): boolean {
    try {
        const index = JSON.parse(indexJson) as { useCases?: { id?: unknown; version?: unknown }[] }
        return (index.useCases ?? []).some((row) => row.id === id && row.version === version)
    } catch {
        return false
    }
}
