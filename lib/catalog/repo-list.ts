import { z } from 'zod'

import {
    addonRowSchema,
    deploymentRefSchema,
    describedRowSchema,
    indexEnvelopeSchema,
    pinnedRowSchema,
    revokedRowSchema,
} from '@/lib/catalog/schema'
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

/**
 * Turns a schema failure into the flat Error this module has always thrown.
 * The message names the field path because it is read in a server log — see
 * the `[repo-list] fetch/validate failed` line below — where a nested issue
 * tree would be noise. Only the first issue is reported: the whole index is
 * rejected either way, so the second one changes no decision.
 */
function fail(where: string, error: z.ZodError): never {
    const issue = error.issues[0]
    const path = issue.path.length > 0 ? `${where}.${issue.path.join('.')}` : where
    throw new Error(`${path} ${issue.message}`)
}

function parseRow<T extends z.ZodType>(schema: T, row: unknown, where: string): z.infer<T> {
    const result = schema.safeParse(row)
    if (!result.success) fail(where, result.error)
    return result.data
}

/** Keys the parser deliberately does not carry into the served index. */
function omit(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
    return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)))
}

/**
 * The one place a parsed row is narrowed to the served type.
 *
 * Rows are LOOSE by design (unknown keys survive — see lib/catalog/schema), so
 * their inferred type carries an index signature that a plain interface cannot
 * satisfy. That needs a cast exactly once; repeating it at every branch below
 * would turn a considered decision into a habit.
 */
function asSummary(row: Record<string, unknown>): CatalogSummary {
    return row as unknown as CatalogSummary
}

/** As `asSummary`, for the add-on section — shape owned by lib/addon-catalog. */
function asAddon(row: Record<string, unknown>): AddonEntry {
    return row as unknown as AddonEntry
}

/**
 * The only normalisation this module applies. The schema validates what is on
 * the wire and returns it unchanged; this turns that into what the rest of the
 * app expects: a commit compared case-insensitively but stored lower-case, and
 * an absent or explicitly null path meaning the repository root.
 */
function normalisePin(pin: z.infer<typeof deploymentRefSchema>): DeploymentRef {
    return {
        url: pin.url,
        ref: pin.ref.toLowerCase(),
        releaseTag: typeof pin.releaseTag === 'string' ? pin.releaseTag : null,
        path: typeof pin.path === 'string' ? pin.path : '.',
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

/**
 * One entry row, in one of its three states. The states are branched here
 * rather than parsed through `catalogSummarySchema`'s union so that a bad row
 * reports its own field path — through the union every row would fail all
 * three branches and report three sets of issues, none of them the point.
 */
function parseSummaryRows(value: unknown, where: string): CatalogSummary[] {
    if (value === undefined) return []
    if (!Array.isArray(value)) throw new Error(`${where} is not an array`)
    return value.map((row, index) => {
        const at = `${where}[${index}]`
        if (!isRecord(row)) throw new Error(`${at} is not an object`)

        // A tombstone exists to be seen in history, never installed. Its pin
        // may carry any historical shape — a pre-v3 `source`, or outright
        // garbage — and is dropped unread, so an old row can never take the
        // live index down. `revoked` is coerced to a strict boolean before
        // parsing: the schema demands a real `true`, because that is the
        // contract a writer owes the catalogue, but at runtime the pin-skip
        // and the visibility filters must never disagree over a truthy oddity.
        if (row.revoked) {
            const parsed = parseRow(revokedRowSchema, { ...row, revoked: true }, at)
            return asSummary(omit(parsed, ['source', 'deploymentRef']))
        }

        // A described entry documents an implementation running elsewhere:
        // listable, never installable. Without this branch a single such row
        // would throw and take the WHOLE index down to last-known-good on
        // every instance — silently, since the catalogue keeps serving the
        // previous state.
        if (isDescribedRow(row)) {
            return asSummary(omit(parseRow(describedRowSchema, row, at), ['source']))
        }

        const parsed = parseRow(pinnedRowSchema, row, at)
        return asSummary({
            ...omit(parsed, ['source']),
            deploymentRef: normalisePin(parsed.deploymentRef),
        })
    })
}

/**
 * Add-on rows are checked for identity only — their real shape belongs to
 * lib/addon-catalog, which parses them into a listing and decides for itself
 * what is installable. Unknown keys therefore have to survive untouched.
 */
function parseAddonRows(value: unknown): AddonEntry[] {
    if (value === undefined) return []
    if (!Array.isArray(value)) throw new Error('addons is not an array')
    return value.map(
        (row, index) => asAddon(parseRow(addonRowSchema, row, `addons[${index}]`)),
    )
}

/**
 * Structural validation of a fetched index against `lib/catalog/schema`.
 *
 * The same schema is rendered for the catalogue repository's CI — see
 * lib/catalog/json-schema for what that gate does and does not yet cover. Until
 * it is in place the catalogue is gated only by its own `ci/validate-index.py`,
 * so a merge request can pass review and still be rejected here — and a
 * rejection blanks the whole index into last-known-good.
 *
 * Throws on ANY malformed row: a half-broken catalogue falls back to
 * last-known-good as a whole, instead of silently serving a partial one.
 */
export function parseRepoListIndex(value: unknown): RepoListIndex {
    const envelope = parseRow(indexEnvelopeSchema, value, 'index')
    return {
        version: envelope.version,
        updatedAt: envelope.updatedAt,
        addons: parseAddonRows(envelope.addons),
        useCases: parseSummaryRows(envelope.useCases, 'useCases'),
        dataStructures: parseSummaryRows(envelope.dataStructures, 'dataStructures'),
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
