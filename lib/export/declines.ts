import type { DeclineReason } from '@/lib/export/merge-request-text'
import type { ShareProposal } from '@/lib/export/share-listing'
import type { BundleStatus, CatalogStatus } from '@/lib/export/status'

// A "no": a proposal closed without being withdrawn, also by hand through the marketplace's account.

export interface Decline {
    iid: number
    mrUrl: string
    closedAt?: string
    /** GitLab username, not display name. */
    closedBy?: string
    viaMarketplace?: boolean
    reason: DeclineReason
}

/** How long a "no" stays the sharing side's move in „In Arbeit“; „Beendet“ keeps it for good. */
export const DECLINE_DAYS = 30

const timeOf = (iso: string | null | undefined) => {
    const time = iso ? Date.parse(iso) : NaN
    return Number.isNaN(time) ? undefined : time
}

/** A merged removal restarts its package's proposals and vice versa: older merges no longer count. */
export function startedOver(merges: readonly (string | null | undefined)[]): number | undefined {
    const times = merges.map(timeOf).filter((time): time is number => time !== undefined)
    return times.length ? Math.max(...times) : undefined
}

/** `>=`: a merge without its own time is dated by its opening. */
export function sinceStart(createdAt: string | null | undefined, since: number | undefined): boolean {
    const created = timeOf(createdAt)
    return since === undefined || created === undefined || created >= since
}

/** A catalogue entry has none: the index decides there. */
const RESTARTED_BY: Partial<Record<ShareProposal['kind'], ShareProposal['kind']>> = { bundle: 'removal', removal: 'bundle' }

/** Since the version last started over; newest first, as the listing keeps them. */
export function presentProposals(proposals: readonly ShareProposal[], kind: ShareProposal['kind']): ShareProposal[] {
    const other = RESTARTED_BY[kind]
    const since = other
        ? startedOver(proposals.filter((proposal) => proposal.kind === other && proposal.state === 'merged').map((proposal) => proposal.mergedAt ?? proposal.createdAt))
        : undefined
    return proposals.filter((proposal) => proposal.kind === kind && sinceStart(proposal.createdAt, since))
}

export function declinedProposal(proposals: readonly ShareProposal[], kind: ShareProposal['kind']): ShareProposal | undefined {
    const own = presentProposals(proposals, kind)
    if (own.some((proposal) => proposal.state === 'merged')) return undefined
    const newest = own[0]
    return newest?.state === 'closed' && !newest.withdrawnBy ? newest : undefined
}

/** A closed change to an accepted version: a note on its row, not a "no". */
export function declinedChange(proposals: readonly ShareProposal[]): ShareProposal | undefined {
    const own = presentProposals(proposals, 'bundle')
    const newest = own[0]
    return newest?.state === 'closed' && !newest.withdrawnBy && own.some((proposal) => proposal.state === 'merged') ? newest : undefined
}

/** Maybe a withdrawal from before the mark existed; removals are never withdrawn from here. */
export function mayBeWithdrawn(proposal: Pick<ShareProposal, 'kind' | 'closedByBot' | 'reason'>): boolean {
    return proposal.kind !== 'removal' && Boolean(proposal.closedByBot) && proposal.reason?.kind === 'unreadable'
}

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

export function laterDecline(a: Decline | undefined, b: Decline | undefined): Decline | undefined {
    if (!a || !b) return a ?? b
    return (timeOf(a.closedAt) ?? -Infinity) > (timeOf(b.closedAt) ?? -Infinity) ? a : b
}

const DAY = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' })

/** „ am 22.10.“ with its leading space, or ''. */
export function declinedOn(decline: Pick<Decline, 'closedAt'>): string {
    const time = timeOf(decline.closedAt)
    return time === undefined ? '' : ` am ${DAY.format(time)}`
}

/** A close through the marketplace's account names nobody: whoever used it is unknown. */
export function reasonWords(decline: Pick<Decline, 'reason' | 'closedBy' | 'viaMarketplace'>): string {
    switch (decline.reason.kind) {
        case 'given':
            return decline.closedBy && !decline.viaMarketplace ? `Grund (${decline.closedBy}): „${decline.reason.text}“` : `Grund: „${decline.reason.text}“`
        case 'unreadable':
            return 'Der Grund ließ sich gerade nicht lesen.'
        default:
            return 'Ohne Begründung.'
    }
}

export function reasonLine(decline: Pick<Decline, 'reason' | 'closedBy' | 'viaMarketplace'>): string {
    if (!decline.viaMarketplace) return reasonWords(decline)
    return decline.reason.kind === 'none' ? 'Über das Marktplatz-Konto geschlossen, ohne Begründung.' : `Über das Marktplatz-Konto geschlossen. ${reasonWords(decline)}`
}

const VIA_ACCOUNT = ' (über das Marktplatz-Konto geschlossen)'

/** The rest of a sentence that starts with what was turned down („Das Entfernen …“). */
export function declinedBy(decline: Pick<Decline, 'closedAt' | 'viaMarketplace'>): string {
    return decline.viaMarketplace ? `wurde${declinedOn(decline)} nicht angenommen${VIA_ACCOUNT}` : `hat das Katalog-Team${declinedOn(decline)} nicht angenommen`
}

/** Must agree with `rowOutcome`: of two "no"s the later one is the news. */
export function removalDeclineShown(bundle: BundleStatus | undefined, catalog: CatalogStatus | undefined): Decline | undefined {
    if (bundle?.state !== 'on-base' || catalog?.state === 'listed' || catalog?.state === 'mr-open' || catalog?.state === 'withdrawn') return undefined
    const removal = bundle.removal?.declined
    const entry = catalog?.state === 'declined' ? catalog.declined : undefined
    return removal && laterDecline(entry, removal) === removal ? removal : undefined
}

export function packageRefusal(version: string, decline: Decline, instead: string): string {
    return `Nicht eingereicht: Version ${version} ${declinedBy(decline)}. Trag im Steckbrief eine höhere Version ein, zum Beispiel ${instead}.`
}

/** `instead` is optional: „In Arbeit“ has no Steckbrief. */
export function entryRefusal(version: string, decline: Decline, instead?: string): string {
    const said = decline.viaMarketplace
        ? `Der Eintrag für Version ${version} wurde${declinedOn(decline)} nicht angenommen (Vorschlag !${decline.iid}, über das Marktplatz-Konto geschlossen)`
        : `Das Katalog-Team hat den Eintrag für Version ${version}${declinedOn(decline)} nicht angenommen (Vorschlag !${decline.iid})`
    return `Kein Katalog-Eintrag: ${said}. Für diese Version schlägt der Marktplatz ihn nicht noch einmal vor - teile eine neue Version${instead ? `, zum Beispiel ${instead}` : ''}.`
}

export function removalRefusal(decline: Decline): string {
    const said = decline.viaMarketplace
        ? `Das Entfernen dieser Version wurde${declinedOn(decline)} nicht angenommen (Vorschlag !${decline.iid}, über das Marktplatz-Konto geschlossen)`
        : `Das Katalog-Team hat das Entfernen dieser Version${declinedOn(decline)} nicht angenommen (Vorschlag !${decline.iid})`
    return `${said}. Noch einmal vorschlagen geht von hier nicht - nur das Katalog-Team kann den Vorschlag wieder öffnen.`
}
