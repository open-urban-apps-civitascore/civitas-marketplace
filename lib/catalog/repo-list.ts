import type {
    AddonEntry,
    CatalogMeta,
    CatalogSummary,
    DeploymentRef,
    RepoListIndex,
} from '@/lib/catalog/types'

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

const COMMIT_SHA = /^[0-9a-f]{40}$/i
/**
 * One segment of a package path as the raw-URL fetch embeds it. Deliberately
 * an allowlist: URL parsers normalise dot segments (plain AND percent-encoded),
 * so a `..` anywhere in the path would consume the pinned-SHA URL segment and
 * re-target the fetch at a mutable ref. No legitimate package path needs
 * anything outside this set.
 */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function parsePinPath(value: unknown, where: string): string {
    // Explicit null counts as absent, like deploymentRef/releaseTag: one
    // serializer writing null instead of omitting the key must not blank
    // every instance's catalogue (any malformed row rejects the whole index).
    if (value === undefined || value === null || value === '.') return '.'
    if (typeof value !== 'string' || !value.split('/').every((s) => SAFE_PATH_SEGMENT.test(s))) {
        throw new Error(`${where} must be a plain relative path`)
    }
    return value
}

/**
 * The row's content pointer (catalogue format v3): a `deploymentRef` whose
 * `ref` IS the commit. Anything else — a tag, a branch — belongs in
 * `releaseTag` or nowhere: a name here would resolve to a fresh commit on
 * every install, laundering mutable content through the pin. The legacy
 * `source.{repoUrl,gitIdentifier}` shape is no longer read; the migrated
 * catalogue no longer publishes it on live rows.
 */
function parseDeploymentRef(row: Record<string, unknown>, where: string): DeploymentRef {
    const deployment = row.deploymentRef
    if (
        !isRecord(deployment) ||
        typeof deployment.url !== 'string' ||
        !deployment.url ||
        typeof deployment.ref !== 'string' ||
        !deployment.ref
    ) {
        throw new Error(`${where} needs a deploymentRef with string fields 'url' and 'ref'`)
    }
    if (!deployment.url.startsWith('https://')) {
        throw new Error(`${where}.deploymentRef.url must be an https URL`)
    }
    if (!COMMIT_SHA.test(deployment.ref)) {
        throw new Error(`${where}.deploymentRef.ref must be a full 40-hex commit SHA`)
    }
    if (deployment.releaseTag !== undefined && deployment.releaseTag !== null &&
        typeof deployment.releaseTag !== 'string') {
        throw new Error(`${where}.deploymentRef.releaseTag must be a string or null`)
    }
    return {
        url: deployment.url,
        ref: deployment.ref.toLowerCase(),
        releaseTag: typeof deployment.releaseTag === 'string' ? deployment.releaseTag : null,
        path: parsePinPath(deployment.path, `${where}.deploymentRef.path`),
    }
}

/**
 * Validates the optional `implementation` block. Only the reference URL is
 * checked, because it is the one field the UI turns into a link — a typo there
 * would render a dead button rather than fail visibly. Everything else is
 * curated prose we would only be guessing about.
 */
function checkImplementation(row: Record<string, unknown>, where: string): void {
    const implementation = row.implementation
    if (implementation === undefined) return
    if (!isRecord(implementation)) {
        throw new Error(`${where}.implementation is not an object`)
    }
    const reference = implementation.reference
    if (reference === undefined) return
    if (
        !isRecord(reference) ||
        typeof reference.url !== 'string' ||
        !reference.url.startsWith('https://')
    ) {
        throw new Error(`${where}.implementation.reference needs an https 'url'`)
    }
}

/**
 * True for a row that documents an implementation running elsewhere: no repo,
 * no commit, nothing to install. Recognised by the reference link and NEVER by
 * a missing pin alone — a row that simply forgot its `deploymentRef` must keep
 * failing loudly instead of quietly degrading into a link card.
 */
function isDescribedRow(row: Record<string, unknown>): boolean {
    if (row.deploymentRef !== undefined) return false
    const implementation = row.implementation
    return isRecord(implementation) && isRecord(implementation.reference)
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
        const rest = Object.fromEntries(
            Object.entries(row).filter(([key]) => key !== 'source' && key !== 'deploymentRef'),
        )
        // A tombstone exists to be seen in history, never installed — its
        // historical pin data (possibly a pre-v3 shape) is deliberately not
        // parsed, so an old shape can never take the live index down. The
        // flag is normalised to a strict boolean here, so the pin-skip and
        // the visibility filters can never disagree on a truthy oddity.
        if (row.revoked) {
            return { ...rest, revoked: true } as unknown as CatalogSummary
        }
        checkImplementation(row, `${where}[${index}]`)
        // A described entry documents an implementation elsewhere: listable,
        // never installable. Without this branch a single such row would throw
        // and take the WHOLE index down to last-known-good on every instance —
        // silently, since the catalogue keeps serving the previous state.
        if (isDescribedRow(row)) {
            return { ...rest } as unknown as CatalogSummary
        }
        const deploymentRef = parseDeploymentRef(row, `${where}[${index}]`)
        return { ...rest, deploymentRef } as unknown as CatalogSummary
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
