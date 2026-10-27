import { presentProposals, reasonWords } from '@/lib/export/declines'
import { inProgressHref } from '@/lib/export/in-progress-items'
import type { SharedPackageRow } from '@/lib/export/share-listing'
import { sameVersionAgain, sharedPackageOf, usedVersions } from '@/lib/export/shared-package'
import { isNewerVersion, sentence } from '@/lib/export/share-stages'
import { declinedKindOf, instanceMatch, ofUnknownInstance, OPEN_OUTCOMES, type EndedEntry, type Ending, type TabRow, type TurnedDown } from '@/lib/export/share-tabs'
import { newVersionHref, resubmitHref } from '@/lib/export/wizard-address'

/**
 * How one row of „Beendet“ reads: what ended, how, when and through whom, the
 * catalogue team's words and at most one action. Pure, for the list and its tests.
 * A close through the marketplace's account is „Nicht angenommen“, but told as
 * „über das Marktplatz-Konto“, never as the catalogue team's decision.
 */

export const ENDING_LABELS: Record<Ending, string> = {
    withdrawn: 'Zurückgezogen',
    'not-accepted': 'Nicht angenommen',
    removed: 'Entfernt',
    'taken-out': 'Aus dem Katalog genommen',
}

/** What the ended proposal was about; a version that ended without one names no kind. */
const WHAT_LABELS: Record<EndedEntry['what'], string | undefined> = {
    bundle: 'Paket',
    catalog: 'Katalog-Eintrag',
    removal: 'Entfernen',
    version: undefined,
}

/**
 * A closed package proposal that was opened while the same version stood
 * accepted: it proposed a change, and the package stayed accepted, so the row must
 * not read as the package's "no" - also once a removal took the version out later.
 */
function changesAccepted(entry: EndedEntry): boolean {
    const { proposal } = entry
    if (entry.what !== 'bundle' || proposal?.state !== 'closed' || !entry.row.proposals) return false
    const proposals = entry.row.proposals
    // The acceptances as they stood when it was opened; a removal counts from when it was merged.
    const opened = proposal.createdAt ?? ''
    const before = proposals.filter((other) => ((other.kind === 'removal' ? other.mergedAt : undefined) ?? other.createdAt ?? '') <= opened)
    return presentProposals(before, 'bundle').some((other) => other !== proposal && other.state === 'merged')
}

/**
 * „Änderung am Paket“ for a change of an accepted package; „Paket“ for an
 * accepted removal, as „Entfernen · Entfernt“ would say it twice.
 */
function whatOf(entry: EndedEntry): string | undefined {
    if (changesAccepted(entry)) return 'Änderung am Paket'
    if (entry.what === 'removal' && entry.ending === 'removed') return 'Paket'
    return WHAT_LABELS[entry.what]
}

const DAY = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' })

/** How many rows „Beendet“ shows at first, and how many more each „Ältere anzeigen“ adds. */
export const ENDED_PAGE = 30

/** The id of row `index` (from 0), for the focus after „Ältere anzeigen“. */
export const endedRowId = (index: number) => `beendet-${index + 1}`

/**
 * A row's one action: „Erneut einreichen“ (the same version), „Neue Version
 * teilen“ (filled from this version, at the next free one), or the link to the
 * version's row in „In Arbeit“, where the package goes on.
 */
export type EndedAction =
    | { kind: 'resubmit'; href: string }
    | { kind: 'new-version'; href: string }
    | { kind: 'in-progress'; version: string; href: string; declined?: TurnedDown }

export interface EndedLine {
    title: string
    version: string
    /** „Paket“, „Änderung am Paket“, „Katalog-Eintrag“, „Entfernen“; absent for a version gone by hand or taken out. */
    what?: string
    /** The ended proposal's number: two endings of one kind and version read apart by it. */
    proposal?: number
    ending: string
    /** „12.10.2026“, or „Datum unbekannt“. */
    when: string
    /** Through whom, as far as GitLab tells: proposers by display name, reviewers by GitLab username. */
    who?: string
    /** The catalogue team's words to a "no" (`reasonWords`), or the index's reason for a version taken out. */
    reason?: string
    /** An older share that names no instance while this one has a name: told, and offered nothing. */
    unknownInstance?: boolean
    /** Where to look at GitLab: the proposal that ended, else the version's package proposal. */
    url: string
    action?: EndedAction
}

function whoOf(entry: EndedEntry): string | undefined {
    const proposal = entry.proposal
    switch (entry.ending) {
        case 'withdrawn':
            return proposal?.withdrawnBy ? `von ${proposal.withdrawnBy}` : undefined
        case 'not-accepted':
            if (proposal?.closedByBot) return 'über das Marktplatz-Konto'
            return proposal?.closedBy ? `von ${proposal.closedBy}` : undefined
        case 'removed': {
            if (entry.byHand) return 'von Hand bei GitLab'
            const parts = [
                proposal?.proposedBy ? `vorgeschlagen von ${proposal.proposedBy}` : undefined,
                proposal?.mergedBy ? `angenommen von ${proposal.mergedBy}` : undefined,
            ].filter(Boolean)
            return parts.length ? parts.join(', ') : undefined
        }
        case 'taken-out':
            return 'Katalog-Team'
    }
}

/**
 * The catalogue team's words, without the reviewer's name the line above shows.
 * A reason never read counts as none, as `declineOf` reads it.
 */
function reasonOf(entry: EndedEntry): string | undefined {
    // With one full stop, as „In Arbeit“ and „Auswählen“ tell the same reason.
    if (entry.ending === 'taken-out') return entry.reason ? `Grund: ${sentence(entry.reason)}` : undefined
    if (entry.ending !== 'not-accepted' || !entry.proposal) return undefined
    return reasonWords({ reason: entry.proposal.reason ?? { kind: 'none' }, ...(entry.proposal.closedByBot ? { viaMarketplace: true } : {}) })
}

/** What a row's action depends on beyond its own ending. */
export interface EndedContext {
    rows: readonly SharedPackageRow[]
    inProgress: readonly TabRow[]
    instance?: string
}

const higherFirst = (a: TabRow, b: TabRow) => (isNewerVersion(a.row.version, b.row.version) ? -1 : isNewerVersion(b.row.version, a.row.version) ? 1 : 0)

/** The link to a version's row in „In Arbeit“, telling a "no" there as one. */
const inProgressOf = (tabbed: TabRow): EndedAction => ({
    kind: 'in-progress',
    version: tabbed.row.version,
    href: inProgressHref(tabbed.row),
    ...declinedKindOf(tabbed.outcome),
})

/**
 * `allowed` as `sameVersionAgain` says; `blocked` where a higher version is used up
 * already, since the server takes only a version above everything accepted and listed.
 */
interface Again {
    allowed: boolean
    blocked: boolean
}

/**
 * The action by the ending: withdrawn - the same version again; removed - the
 * same where it never reached the catalogue, else a new one; otherwise a new one.
 * A withdrawn package blocked by a higher version (perhaps another instance's)
 * gets a new one, or nothing would lead on; a withdrawn entry offers nothing,
 * as its package stays accepted.
 */
function byEnding(entry: EndedEntry, again: Again): EndedAction | undefined {
    const shared = { ...(entry.row.source?.id ? { datasetId: entry.row.source.id } : {}), slug: entry.row.slug, version: entry.version }
    const resubmit: EndedAction = { kind: 'resubmit', href: resubmitHref(shared) }
    const newVersion: EndedAction = { kind: 'new-version', href: newVersionHref(shared) }
    const same = again.allowed && !again.blocked
    switch (entry.ending) {
        case 'withdrawn':
            return same ? resubmit : again.blocked && entry.what === 'bundle' ? newVersion : undefined
        case 'removed':
            return same ? resubmit : newVersion
        default:
            return newVersion
    }
}

/**
 * At most one action, only where the way on is this row's: else the link to a
 * newer version in „In Arbeit“, or to this one where it has a proposal open
 * there or the ending offers nothing; nothing where a newer one was proposed
 * from here, or for an unknown instance.
 */
export function endedAction(entry: EndedEntry, { rows, inProgress, instance }: EndedContext): EndedAction | undefined {
    if (entry.origin === 'other' || ofUnknownInstance(entry.origin, instance)) return undefined
    const { row } = entry
    const samePackage = (other: SharedPackageRow) => other.targetKey === row.targetKey && other.slug === row.slug
    const working = inProgress.filter((tabbed) => samePackage(tabbed.row))
    const newer = working.filter((tabbed) => isNewerVersion(tabbed.row.version, entry.version)).sort(higherFirst)[0]
    if (newer) return inProgressOf(newer)
    if (rows.some((other) => samePackage(other) && instanceMatch(other.source, instance) !== 'other' && isNewerVersion(other.version, entry.version))) return undefined
    // Version numbers count across instances, so every instance's versions decide.
    const pkg = sharedPackageOf(rows, { slug: row.slug, targetKey: row.targetKey, anyInstance: true }, instance)
    const allowed = sameVersionAgain(pkg, entry.version)
    const own = byEnding(entry, { allowed, blocked: allowed && (pkg ? usedVersions(pkg) : []).some((used) => isNewerVersion(used, entry.version)) })
    const same = working.find((tabbed) => tabbed.row.version === entry.version)
    if (same && (!own || OPEN_OUTCOMES.has(same.outcome))) return inProgressOf(same)
    return own
}

/** One row of „Beendet“; its action and `unknownInstance` only with `context`, which both depend on. */
export function endedLine(entry: EndedEntry, context?: EndedContext): EndedLine {
    const what = whatOf(entry)
    const who = whoOf(entry)
    const reason = reasonOf(entry)
    const action = context ? endedAction(entry, context) : undefined
    return {
        title: entry.row.displayName,
        version: entry.version,
        ...(what ? { what } : {}),
        // 0 for a row built without its proposals: no number told then.
        ...(entry.proposal?.iid ? { proposal: entry.proposal.iid } : {}),
        ending: ENDING_LABELS[entry.ending],
        when: entry.at ? DAY.format(new Date(entry.at)) : 'Datum unbekannt',
        ...(who ? { who } : {}),
        ...(reason ? { reason } : {}),
        ...(context && ofUnknownInstance(entry.origin, context.instance) ? { unknownInstance: true } : {}),
        url: entry.proposal?.url ?? entry.row.bundleMr.url,
        ...(action ? { action } : {}),
    }
}

/** „Katalog-Eintrag · Nicht angenommen · Vorschlag !12“: what ended, how, and which proposal where there was one. */
export function endedWhat(line: Pick<EndedLine, 'what' | 'ending' | 'proposal'>): string {
    return [line.what, line.ending, line.proposal ? `Vorschlag !${line.proposal}` : undefined].filter(Boolean).join(' · ')
}
