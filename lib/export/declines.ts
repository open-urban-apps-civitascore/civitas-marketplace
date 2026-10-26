import type { DeclineReason } from '@/lib/export/merge-request-text'
import type { ShareProposal } from '@/lib/export/share-listing'

/**
 * When the catalogue team says no: a proposal of a package, its catalogue
 * entry or its removal, closed without being withdrawn - by a reviewer, or by
 * hand through the marketplace's own account, which counts as a "no" too.
 * What was turned down is used up for that version; the way on is a higher
 * version, or the team reopens it.
 *
 * Only the newest proposal of its kind counts, and only while nothing from its
 * branch was merged since the version last started over: a merge beats a later
 * closed duplicate. Pure, for the listing, the tab rules and the server's checks.
 */

/** One "no", as the pages and the refusals tell it. */
export interface Decline {
    /** The proposal that was turned down. */
    iid: number
    mrUrl: string
    closedAt?: string
    /** GitLab username: reviewers are named that way. */
    closedBy?: string
    /** Closed through the marketplace's own account: told as „über das Marktplatz-Konto“. */
    viaMarketplace?: boolean
    reason: DeclineReason
}

/** How long a "no" stays the sharing side's move in „In Arbeit“; „Beendet“ keeps it for good. */
export const DECLINE_DAYS = 30

const timeOf = (iso: string | null | undefined) => {
    const time = iso ? Date.parse(iso) : NaN
    return Number.isNaN(time) ? undefined : time
}

/**
 * When a version last started over: the newest of `merges`, the times of
 * merges of the other kind (merged, else opened). A merged removal restarts
 * its package's proposals and vice versa; what came before decides nothing,
 * so an old merge no longer beats a later "no". Undefined while it never
 * started over.
 */
export function startedOver(merges: readonly (string | null | undefined)[]): number | undefined {
    const times = merges.map(timeOf).filter((time): time is number => time !== undefined)
    return times.length ? Math.max(...times) : undefined
}

/**
 * Whether a proposal opened at `createdAt` counts since `since` (`startedOver`).
 * One without a date does, and so does one of the same moment: a merge without
 * its own time is dated by its opening.
 */
export function sinceStart(createdAt: string | null | undefined, since: number | undefined): boolean {
    const created = timeOf(createdAt)
    return since === undefined || created === undefined || created >= since
}

/** The merges that start proposals of `kind` over; a catalogue entry has none - the index decides there. */
const RESTARTED_BY: Partial<Record<ShareProposal['kind'], ShareProposal['kind']>> = { bundle: 'removal', removal: 'bundle' }

/** A version's proposals of `kind` since it last started over, newest first as the listing keeps them. */
export function presentProposals(proposals: readonly ShareProposal[], kind: ShareProposal['kind']): ShareProposal[] {
    const other = RESTARTED_BY[kind]
    const since = other
        ? startedOver(proposals.filter((proposal) => proposal.kind === other && proposal.state === 'merged').map((proposal) => proposal.mergedAt ?? proposal.createdAt))
        : undefined
    return proposals.filter((proposal) => proposal.kind === kind && sinceStart(proposal.createdAt, since))
}

/** The newest of a version's present proposals of `kind`, when it is a "no". */
export function declinedProposal(proposals: readonly ShareProposal[], kind: ShareProposal['kind']): ShareProposal | undefined {
    const own = presentProposals(proposals, kind)
    if (own.some((proposal) => proposal.state === 'merged')) return undefined
    const newest = own[0]
    return newest?.state === 'closed' && !newest.withdrawnBy ? newest : undefined
}

/** A change the catalogue team did not take, while an older merge still stands: the version stays accepted, so a note on its row, not a "no". */
export function declinedChange(proposals: readonly ShareProposal[]): ShareProposal | undefined {
    const own = presentProposals(proposals, 'bundle')
    const newest = own[0]
    return newest?.state === 'closed' && !newest.withdrawnBy && own.some((proposal) => proposal.state === 'merged') ? newest : undefined
}

/**
 * A "no" that may be none: closed by the marketplace's account without the
 * mark and with unreadable comments, so it may be a withdrawal from before the
 * mark existed. Nobody's move until they can be read. Removals are never
 * withdrawn from here, so a closed one is a "no" either way.
 */
export function mayBeWithdrawn(proposal: Pick<ShareProposal, 'kind' | 'closedByBot' | 'reason'>): boolean {
    return proposal.kind !== 'removal' && Boolean(proposal.closedByBot) && proposal.reason?.kind === 'unreadable'
}

/** A listed proposal's "no" as the pages tell it; a reason never read counts as none given. */
export function declineOf(proposal: ShareProposal): Decline {
    return {
        iid: proposal.iid,
        mrUrl: proposal.url,
        ...(proposal.closedAt ? { closedAt: proposal.closedAt } : {}),
        ...(proposal.closedBy ? { closedBy: proposal.closedBy } : {}),
        ...(proposal.closedByBot ? { viaMarketplace: true } : {}),
        reason: proposal.reason ?? { kind: 'none' },
    }
}

/** The later of two "no"s, by when they were closed; one without a date counts as the older, and `b` wins a tie. */
export function laterDecline(a: Decline | undefined, b: Decline | undefined): Decline | undefined {
    if (!a || !b) return a ?? b
    return (timeOf(a.closedAt) ?? -Infinity) > (timeOf(b.closedAt) ?? -Infinity) ? a : b
}

const DAY = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' })

/** „ am 22.10.“ for when a "no" was given, or nothing when GitLab names no date. */
export function declinedOn(decline: Pick<Decline, 'closedAt'>): string {
    const time = timeOf(decline.closedAt)
    return time === undefined ? '' : ` am ${DAY.format(time)}`
}

/** Why a version is not submitted again; a close through the marketplace's account counts as a "no", but not as the team's decision. `instead`: the version to take. */
export function packageRefusal(version: string, decline: Decline, instead: string): string {
    const said = decline.viaMarketplace
        ? `Version ${version} wurde${declinedOn(decline)} über das Marktplatz-Konto geschlossen und gilt als nicht angenommen.`
        : `Version ${version} hat das Katalog-Team${declinedOn(decline)} nicht angenommen.`
    return `Nicht eingereicht: ${said} Nimm eine höhere Version, zum Beispiel ${instead}.`
}

/** Why an entry is not proposed again for this version, told as {@link packageRefusal} tells it. */
export function entryRefusal(version: string, decline: Decline): string {
    const said = decline.viaMarketplace
        ? `Der Eintrag für Version ${version} wurde${declinedOn(decline)} über das Marktplatz-Konto geschlossen und gilt als nicht angenommen`
        : `Das Katalog-Team hat den Eintrag für Version ${version}${declinedOn(decline)} nicht angenommen`
    return `Kein Katalog-Eintrag: ${said} (Vorschlag !${decline.iid}). Für diese Version schlägt der Marktplatz ihn nicht noch einmal vor - teile eine neue Version.`
}

/** Why a removal is not proposed again, with the proposal to look at. */
export function removalRefusal(decline: Decline): string {
    const said = decline.viaMarketplace
        ? `Das Entfernen dieser Version wurde${declinedOn(decline)} über das Marktplatz-Konto geschlossen und gilt als nicht angenommen`
        : `Das Katalog-Team hat das Entfernen dieser Version${declinedOn(decline)} nicht angenommen`
    return `${said} (Vorschlag !${decline.iid}). Noch einmal vorschlagen geht von hier nicht - frag beim Katalog-Team nach.`
}
