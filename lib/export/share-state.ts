import type { ExportActionResult } from '@/lib/export-actions'
import type { SharedPackageRow } from '@/lib/export/share-listing'
import { isNewerVersion } from '@/lib/export/share-stages'
import type { BundleStatus, CatalogStatus } from '@/lib/export/status'

/**
 * What this page knows about one package version: where its merge request
 * stands, and where the catalogue entry's does.
 *
 * Kept apart from the latest action result on purpose. "Status prüfen"
 * overwrites that result and "Steckbrief bearbeiten" clears it, so a button
 * that read it came back after its merge request was open - and a second
 * click could propose the same version again (Ewa, 2026-10-13).
 */
export interface ShareKnowledge {
    bundle?: BundleStatus
    catalog?: CatalogStatus
}

/**
 * Knowledge per version, keyed by `shareKey`. One entry per key, not one
 * entry at all: a preview of another version must not forget the merge
 * request of the first, or switching back would offer to propose it again.
 */
export type ShareStates = Readonly<Record<string, ShareKnowledge>>

/** Lower-cased because the server lower-cases publisher and slug before it builds ids and branches. */
export function shareKey(input: { targetKey: string; publisher: string; slug: string; version: string }): string {
    return [input.targetKey, input.publisher, input.slug, input.version].map((part) => part.trim().toLowerCase()).join(':')
}

/**
 * Folds one action result into what is known. A merge request an action
 * opened, or found already open, counts at once; a reading the server sends
 * along (status check, catalogue step) replaces what was assumed. A result
 * that says nothing about either (preview, refusal, error) changes nothing.
 */
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

/**
 * Whether a catalogue-step answer from „In Arbeit“ leaves the list behind
 * GitLab, so it is read again: a proposal opened or found open, or a "no" -
 * else the row would still offer the proposal it was refused.
 */
export function listingIsStale(result: ExportActionResult): boolean {
    return result.status === 'ok' || result.status === 'already-open' || result.catalog?.state === 'declined'
}

/**
 * What the catalogue team took out of this package, from the reading of any
 * of its versions: it stays true when the person types a higher version,
 * which is when it matters. This version's own reading comes first.
 */
export function takenOutOf(states: ShareStates, key: string): CatalogStatus['takenOut'] {
    const own = states[key]?.catalog?.takenOut
    if (own) return own
    // The version is the key's last part, and has no colon of its own.
    const samePackage = key.slice(0, key.lastIndexOf(':') + 1)
    return Object.entries(states).find(([other, known]) => other.startsWith(samePackage) && known.catalog?.takenOut)?.[1].catalog?.takenOut
}

/** A version the catalogue team changed while reviewing it, and where their change is to see. */
export interface ReviewChange {
    version: string
    /** The commits of the proposal they merged („Änderung ansehen“). */
    changeUrl: string
}

/**
 * The version on the base branch that the catalogue team changed in review
 * (`changedInReview`), when `share` is newer and would write over their
 * change. Undefined while the listing is not read.
 */
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

/** Where the catalogue team's change in review is to see: the commits of the proposal they merged. */
export function reviewChangeUrl(mergedMrUrl: string): string {
    return `${mergedMrUrl.replace(/\/+$/, '')}/commits`
}

/** `states` with one result folded into the entry for `key`; the other versions stay as they were. */
export function rememberShareResult(states: ShareStates, key: string, result: ExportActionResult): ShareStates {
    return { ...states, [key]: mergeShareResult(states[key] ?? {}, result) }
}

/** "!18" for a GitLab merge request address, or undefined when the address names none. */
export function mergeRequestRef(url: string | undefined): string | undefined {
    const iid = url?.match(/\/merge_requests\/(\d+)/)?.[1]
    return iid ? `!${iid}` : undefined
}
