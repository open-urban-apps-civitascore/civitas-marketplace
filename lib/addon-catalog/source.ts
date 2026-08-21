import { parseCatalogAddon, type ParsedAddon } from './listing'

/**
 * Reads the add-on list from the curated catalogue repository.
 *
 * The catalogue is a plain JSON file in git (`civitas-marketplace-catalog`):
 * a merge request is the submission, review is the curation, and the raw file
 * is the API. Nothing else is needed to publish an add-on, which is the whole
 * point of the GitOps story.
 *
 * Fetch policy: cached for a few minutes and kept as last-known-good, so a
 * temporarily unreachable catalogue degrades to slightly stale data rather
 * than an empty page. What it never does is invent entries — an unconfigured
 * or unreadable catalogue says so.
 */

const TTL_MS = 5 * 60 * 1000

/**
 * The catalogue format this app understands. The catalogue publishes
 * `catalogVersion` precisely so a client can refuse what it cannot read —
 * silently mis-parsing a newer format would show an operator a degraded
 * catalogue with no hint that the application, not the catalogue, is the
 * problem.
 */
const SUPPORTED_CATALOG_VERSION = 1

export type CatalogState =
    /** Freshly fetched. */
    | 'ok'
    /** No ADDON_CATALOG_URL configured — the catalogue is an operator setting. */
    | 'unconfigured'
    /** Never fetched successfully; nothing to show. */
    | 'unreachable'
    /** The fetch failed but an earlier result is still being served. */
    | 'stale'
    /** The catalogue is newer than this application can read. */
    | 'incompatible'

export interface AddonCatalogResult {
    addons: ParsedAddon[]
    state: CatalogState
    url?: string
    /** When the served data was fetched — the honest age of a stale result. */
    fetchedAt?: string
    /** Why the last fetch failed, for the stale/unreachable states. */
    error?: string
    /** Entries the catalogue contained but this app could not read. */
    skipped: number
}

interface CacheEntry {
    url: string
    addons: ParsedAddon[]
    fetchedAt: number
    skipped: number
}

// Module-level, i.e. per server process. Good enough deliberately: the data is
// public, small and identical for every user, and a shared cache would be a
// dependency this app does not otherwise need.
let cache: CacheEntry | null = null

export function catalogUrl(): string | undefined {
    return process.env.ADDON_CATALOG_URL?.trim() || undefined
}

export async function fetchAddonCatalog(): Promise<AddonCatalogResult> {
    const url = catalogUrl()
    if (!url) {
        return { addons: [], state: 'unconfigured', skipped: 0 }
    }

    const fresh = cache && cache.url === url && Date.now() - cache.fetchedAt < TTL_MS
    if (fresh && cache) {
        return {
            addons: cache.addons,
            state: 'ok',
            url,
            fetchedAt: new Date(cache.fetchedAt).toISOString(),
            skipped: cache.skipped,
        }
    }

    try {
        const response = await fetch(url, { cache: 'no-store' })
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
        }

        const payload = (await response.json()) as {
            addons?: unknown
            catalogVersion?: unknown
        } | null

        const version = typeof payload?.catalogVersion === 'number' ? payload.catalogVersion : 1
        if (version > SUPPORTED_CATALOG_VERSION) {
            return {
                addons: [],
                state: 'incompatible',
                url,
                error: `Katalogformat ${version}, unterstützt wird ${SUPPORTED_CATALOG_VERSION}`,
                skipped: 0,
            }
        }

        const raw = payload?.addons
        if (!Array.isArray(raw)) {
            throw new Error('Die Katalogdatei enthält keine addons-Liste')
        }

        const addons: ParsedAddon[] = []
        for (const item of raw) {
            const parsed = parseCatalogAddon(item)
            if (parsed) addons.push(parsed)
        }

        cache = { url, addons, fetchedAt: Date.now(), skipped: raw.length - addons.length }
        return {
            addons,
            state: 'ok',
            url,
            fetchedAt: new Date(cache.fetchedAt).toISOString(),
            skipped: cache.skipped,
        }
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)

        if (cache && cache.url === url) {
            return {
                addons: cache.addons,
                state: 'stale',
                url,
                fetchedAt: new Date(cache.fetchedAt).toISOString(),
                error: detail,
                skipped: cache.skipped,
            }
        }

        return { addons: [], state: 'unreachable', url, error: detail, skipped: 0 }
    }
}
