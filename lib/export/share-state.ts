import type { ExportActionResult } from '@/lib/export-actions'
import type { SharedPackageRow } from '@/lib/export/share-listing'
import { isNewerVersion } from '@/lib/export/share-stages'
import type { BundleStatus, CatalogStatus } from '@/lib/export/status'

/**
 * Kept apart from the last action result on purpose: "Status prüfen" overwrites that result and
 * "Steckbrief bearbeiten" clears it, so a button reading it could propose the same version twice.
 */
export interface ShareKnowledge {
    bundle?: BundleStatus
    catalog?: CatalogStatus
}

/** Per version: a preview of another version must not forget the first one's merge request. */
export type ShareStates = Readonly<Record<string, ShareKnowledge>>

/** Lower-cased because the server lower-cases publisher and slug before it builds ids and branches. */
export function shareKey(input: { targetKey: string; publisher: string; slug: string; version: string }): string {
    return [input.targetKey, input.publisher, input.slug, input.version].map((part) => part.trim().toLowerCase()).join(':')
}

export function mergeShareResult(known: ShareKnowledge, result: ExportActionResult): ShareKnowledge {
    let { bundle, catalog } = known
    const proposed = (result.status === 'ok' || result.status === 'already-open') && Boolean(result.mrUrl)
    if (result.intent === 'bundle' && proposed) bundle = { state: 'mr-open', mrUrl: result.mrUrl }
    if (result.intent === 'catalog' && proposed) catalog = { state: 'mr-open', mrUrl: result.mrUrl }
    if (result.intent === 'catalog' && result.status === 'unchanged') catalog = { state: 'listed' }
    if (result.bundle) bundle = result.bundle
    if (result.catalog) catalog = result.catalog
    return { bundle, catalog }
}

/** Also after a "no": else the row would still offer the refused proposal. */
export function listingIsStale(result: ExportActionResult): boolean {
    return result.status === 'ok' || result.status === 'already-open' || result.catalog?.state === 'declined'
}

/** From any version's reading: it matters most once the person types a higher version. */
export function takenOutOf(states: ShareStates, key: string): CatalogStatus['takenOut'] {
    const own = states[key]?.catalog?.takenOut
    if (own) return own
    // The version is the key's last part, and has no colon of its own.
    const samePackage = key.slice(0, key.lastIndexOf(':') + 1)
    return Object.entries(states).find(([other, known]) => other.startsWith(samePackage) && known.catalog?.takenOut)?.[1].catalog?.takenOut
}

export interface ReviewChange {
    version: string
    changeUrl: string
}

/** The version the catalogue team changed in review that a newer `share` would write over. */
export function reviewChangeBelow(
    rows: readonly SharedPackageRow[] | null,
    share: { targetKey: string; slug: string; version: string },
): ReviewChange | undefined {
    const slug = share.slug.trim().toLowerCase()
    const version = share.version.trim()
    const changed = rows?.find(
        (row) =>
            row.targetKey === share.targetKey &&
            row.slug === slug &&
            row.bundle?.state === 'on-base' &&
            row.bundle.verification?.state === 'verified' &&
            row.bundle.verification.changedInReview &&
            isNewerVersion(version, row.version),
    )
    if (!changed) return undefined
    const merged = changed.bundle?.verification?.mergedMrUrl ?? changed.bundleMr.url
    return { version: changed.version, changeUrl: reviewChangeUrl(merged) }
}

export function reviewChangeUrl(mergedMrUrl: string): string {
    return `${mergedMrUrl.replace(/\/+$/, '')}/commits`
}

export function rememberShareResult(states: ShareStates, key: string, result: ExportActionResult): ShareStates {
    return { ...states, [key]: mergeShareResult(states[key] ?? {}, result) }
}

/** "!18" for a merge request address. */
export function mergeRequestRef(url: string | undefined): string | undefined {
    const iid = url?.match(/\/merge_requests\/(\d+)/)?.[1]
    return iid ? `!${iid}` : undefined
}
