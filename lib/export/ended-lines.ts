import { presentProposals, reasonWords } from '@/lib/export/declines'
import { inProgressHref } from '@/lib/export/in-progress-items'
import type { SharedPackageRow } from '@/lib/export/share-listing'
import { sameVersionAgain, sharedPackageOf, usedVersions } from '@/lib/export/shared-package'
import { isNewerVersion, sentence } from '@/lib/export/share-stages'
import { declinedKindOf, instanceMatch, ofUnknownInstance, OPEN_OUTCOMES, type EndedEntry, type Ending, type TabRow, type TurnedDown } from '@/lib/export/share-tabs'
import { newVersionHref, resubmitHref } from '@/lib/export/wizard-address'

export const ENDING_LABELS: Record<Ending, string> = {
    withdrawn: 'Zurückgezogen',
    'not-accepted': 'Nicht angenommen',
    removed: 'Entfernt',
    'taken-out': 'Aus dem Katalog genommen',
}

const WHAT_LABELS: Record<EndedEntry['what'], string | undefined> = {
    bundle: 'Paket',
    catalog: 'Katalog-Eintrag',
    removal: 'Entfernen',
    version: undefined,
}

/** A closed change to an accepted package: not the package's "no", even after a later removal. */
function changesAccepted(entry: EndedEntry): boolean {
    const { proposal } = entry
    if (entry.what !== 'bundle' || proposal?.state !== 'closed' || !entry.row.proposals) return false
    const proposals = entry.row.proposals
    // As things stood when it was opened; a removal counts from its merge.
    const opened = proposal.createdAt ?? ''
    const before = proposals.filter((other) => ((other.kind === 'removal' ? other.mergedAt : undefined) ?? other.createdAt ?? '') <= opened)
    return presentProposals(before, 'bundle').some((other) => other !== proposal && other.state === 'merged')
}

/** „Paket“ for an accepted removal: „Entfernen · Entfernt“ would say it twice. */
function whatOf(entry: EndedEntry): string | undefined {
    if (changesAccepted(entry)) return 'Änderung am Paket'
    if (entry.what === 'removal' && entry.ending === 'removed') return 'Paket'
    return WHAT_LABELS[entry.what]
}

const DAY = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' })

export const ENDED_PAGE = 30

/** The focus target after „Ältere anzeigen“; `index` from 0. */
export const endedRowId = (index: number) => `beendet-${index + 1}`

export type EndedAction =
    | { kind: 'resubmit'; href: string }
    | { kind: 'new-version'; href: string }
    | { kind: 'in-progress'; version: string; href: string; declined?: TurnedDown }

export interface EndedLine {
    title: string
    version: string
    what?: string
    proposal?: number
    ending: string
    when: string
    /** Proposers by display name, reviewers by GitLab username. */
    who?: string
    reason?: string
    unknownInstance?: boolean
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

/** Without the reviewer's name, which `who` shows; an unread reason counts as none, as in `declineOf`. */
function reasonOf(entry: EndedEntry): string | undefined {
    // One full stop, as „In Arbeit“ and „Auswählen“ tell the same reason.
    if (entry.ending === 'taken-out') return entry.reason ? `Grund: ${sentence(entry.reason)}` : undefined
    if (entry.ending !== 'not-accepted' || !entry.proposal) return undefined
    return reasonWords({ reason: entry.proposal.reason ?? { kind: 'none' }, ...(entry.proposal.closedByBot ? { viaMarketplace: true } : {}) })
}

export interface EndedContext {
    rows: readonly SharedPackageRow[]
    inProgress: readonly TabRow[]
    instance?: string
}

const higherFirst = (a: TabRow, b: TabRow) => (isNewerVersion(a.row.version, b.row.version) ? -1 : isNewerVersion(b.row.version, a.row.version) ? 1 : 0)

const inProgressOf = (tabbed: TabRow): EndedAction => ({
    kind: 'in-progress',
    version: tabbed.row.version,
    href: inProgressHref(tabbed.row),
    ...declinedKindOf(tabbed.outcome),
})

/** `blocked`: a higher version is used up, and the server takes only versions above it. */
interface Again {
    allowed: boolean
    blocked: boolean
}

/** A withdrawn entry offers nothing, as its package stays accepted. */
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

export function endedWhat(line: Pick<EndedLine, 'what' | 'ending' | 'proposal'>): string {
    return [line.what, line.ending, line.proposal ? `Vorschlag !${line.proposal}` : undefined].filter(Boolean).join(' · ')
}
