import type { AddonEntry, CatalogMeta, CatalogSummary, RepoListIndex } from '@/lib/catalog/types'

/**
 * The repo-list: a single git-hosted `index.json` (F-Droid model) that every
 * marketplace instance reads to build its catalogue. This module is the only
 * place that fetches it. It runs its own TTL cache and keeps serving the last
 * valid state when the source is unreachable (in-memory last-known-good), so
 * the marketplace stays usable in restrictive municipal networks.
 *
 * The repo-list is the single source of truth for the REMOTE catalogue: when
 * nothing has ever been fetched — no REPO_LIST_URL cold start, or the remote
 * unreachable — the catalogue is served empty (never crashing, but honestly
 * empty) rather than falling back to stale data. The separate mock source
 * (lib/mock-catalog) is a deliberate fixture set, not a fallback of this one.
 *
 * See gitlab.com/civitascore-openurbanapps/civitas-marketplace-catalog.
 */

interface CacheEntry {
    index: RepoListIndex
    /** When the served data was last fetched from the remote. */
    fetchedAt: Date
    origin: CatalogMeta['origin']
    /** true = not live: last-known-good, unconfigured, or unreachable. */
    stale: boolean
}

// The ultimate fallback: an empty catalogue. Never cached, so the next call retries.
const EMPTY_INDEX: RepoListIndex = {
    version: '0.0.0',
    updatedAt: new Date(0).toISOString(),
    addons: [],
    useCases: [],
    dataStructures: [],
}

const DEFAULT_TTL_SECONDS = 900
const FETCH_TIMEOUT_MS = 5000

// Module-scoped: shared across requests within a server process, reset on deploy.
let cache: CacheEntry | undefined

/** Test seam: clears the module-scoped cache between test cases. */
export function resetRepoListCacheForTests(): void {
    cache = undefined
}

function ttlMs(): number {
    const configured = Number(process.env.REPO_LIST_TTL_SECONDS)
    return (
        (Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TTL_SECONDS) * 1000
    )
}

export function repoListUrl(): string | undefined {
    const raw = process.env.REPO_LIST_URL?.trim()
    return raw ? raw : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSummaryRows(value: unknown, where: string): CatalogSummary[] {
    if (value === undefined) return []
    if (!Array.isArray(value)) throw new Error(`${where} is not an array`)
    return value.map((row, index) => {
        if (!isRecord(row)) throw new Error(`${where}[${index}] is not an object`)
        for (const field of [
            'id',
            'displayName',
            'description',
            'version',
            'maintainer',
            'license',
        ]) {
            if (typeof row[field] !== 'string') {
                throw new Error(`${where}[${index}].${field} is missing or not a string`)
            }
        }
        if (row.type !== 'usecase' && row.type !== 'datastructure') {
            throw new Error(`${where}[${index}].type must be 'usecase' or 'datastructure'`)
        }
        if (!Array.isArray(row.keywords)) {
            throw new Error(`${where}[${index}].keywords is not an array`)
        }
        const source = row.source
        if (
            !isRecord(source) ||
            typeof source.repoUrl !== 'string' ||
            typeof source.gitIdentifier !== 'string'
        ) {
            throw new Error(`${where}[${index}].source needs repoUrl and gitIdentifier`)
        }
        return row as unknown as CatalogSummary
    })
}

function parseAddonRows(value: unknown): AddonEntry[] {
    if (value === undefined) return []
    if (!Array.isArray(value)) throw new Error('addons is not an array')
    return value.map((row, index) => {
        if (!isRecord(row)) throw new Error(`addons[${index}] is not an object`)
        for (const field of ['id', 'name', 'description', 'author']) {
            if (typeof row[field] !== 'string') {
                throw new Error(`addons[${index}].${field} is missing or not a string`)
            }
        }
        return row as unknown as AddonEntry
    })
}

/**
 * Structural validation of a fetched index. Throws on ANY malformed row: a
 * half-broken catalogue falls back to last-known-good as a whole, instead of
 * silently serving a partial one. (Zod as the normative schema source is the
 * planned follow-up; this stays the runtime gate until then.)
 */
export function parseRepoListIndex(value: unknown): RepoListIndex {
    if (!isRecord(value)) throw new Error('index is not an object')
    if (typeof value.version !== 'string') throw new Error('index.version is missing')
    if (typeof value.updatedAt !== 'string') throw new Error('index.updatedAt is missing')
    return {
        version: value.version,
        updatedAt: value.updatedAt,
        addons: parseAddonRows(value.addons),
        useCases: parseSummaryRows(value.useCases, 'useCases'),
        dataStructures: parseSummaryRows(value.dataStructures, 'dataStructures'),
    }
}

function emptyEntry(origin: 'unconfigured' | 'unreachable'): CacheEntry {
    return { index: EMPTY_INDEX, fetchedAt: new Date(0), origin, stale: true }
}

async function loadIndex(): Promise<CacheEntry> {
    // Serve a fresh, healthy cache without touching the network. A stale entry
    // is deliberately not short-circuited so we retry the remote next call.
    if (cache && !cache.stale && Date.now() - cache.fetchedAt.getTime() < ttlMs()) {
        return cache
    }

    const url = repoListUrl()
    if (!url) {
        // No repo-list configured — serve an empty catalogue (honest, non-crashing).
        return emptyEntry('unconfigured')
    }

    try {
        const response = await fetch(url, {
            headers: { Accept: 'application/json' },
            // We run our own TTL cache; don't let the framework cache the response too.
            cache: 'no-store',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (!response.ok) {
            throw new Error(`repo-list responded ${response.status} ${response.statusText}`)
        }
        const index = parseRepoListIndex(await response.json())
        cache = { index, fetchedAt: new Date(), origin: 'remote', stale: false }
        return cache
    } catch (error) {
        console.error(`[repo-list] fetch/validate failed for ${url}:`, error)
        // Last-known-good: keep serving the previous valid state, flagged stale.
        if (cache) return (cache = { ...cache, stale: true })
        // Cold start with an unreachable remote and nothing cached: empty catalogue.
        return emptyEntry('unreachable')
    }
}

/** Freshness metadata for the "catalogue as of …" hint in the UI. */
export async function getRepoListMeta(): Promise<CatalogMeta> {
    const { index, fetchedAt, origin, stale } = await loadIndex()
    return { version: index.version, fetchedAt, origin, stale }
}

/** Listable add-ons (revoked entries are hidden — tombstone convention). */
export async function getRepoListAddons(): Promise<AddonEntry[]> {
    return (await loadIndex()).index.addons.filter((addon) => !addon.revoked)
}

/** Listable entries of one type (revoked entries are hidden — tombstone convention). */
export async function getRepoListSummaries(
    type: 'usecase' | 'datastructure',
): Promise<CatalogSummary[]> {
    const { index } = await loadIndex()
    const rows = type === 'usecase' ? index.useCases : index.dataStructures
    return rows.filter((row) => !row.revoked)
}

/** One row by catalogue id, searched across both entry sections. */
export async function findRepoListSummary(id: string): Promise<CatalogSummary | undefined> {
    const { index } = await loadIndex()
    return [...index.useCases, ...index.dataStructures].find(
        (row) => row.id === id && !row.revoked,
    )
}
