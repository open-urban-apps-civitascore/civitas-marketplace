import type { EndedEntry, Ending } from '@/lib/export/share-tabs'

/**
 * How one row of „Beendet“ reads (plan of 2026-10-18, section 6): what
 * ended, how, when and through whom. Pure, for the list and its tests; the
 * fuller rows with their actions come with rc.7.
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

const DAY = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' })

export interface EndedLine {
    title: string
    version: string
    /** „Paket“, „Katalog-Eintrag“, „Entfernen“; absent for a version gone by hand or taken out. */
    what?: string
    ending: string
    /** „12.10.2026“, or „Datum unbekannt“. */
    when: string
    /** Through whom, as far as GitLab tells: proposers by display name, reviewers by GitLab username. */
    who?: string
    /** The catalogue team's reason for taking a version out, when they gave one. */
    reason?: string
    /** Where to look at GitLab: the proposal that ended, else the version's package proposal. */
    url: string
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

export function endedLine(entry: EndedEntry): EndedLine {
    const what = WHAT_LABELS[entry.what]
    const who = whoOf(entry)
    return {
        title: entry.row.displayName,
        version: entry.version,
        ...(what ? { what } : {}),
        ending: ENDING_LABELS[entry.ending],
        when: entry.at ? DAY.format(new Date(entry.at)) : 'Datum unbekannt',
        ...(who ? { who } : {}),
        ...(entry.reason ? { reason: entry.reason } : {}),
        url: entry.proposal?.url ?? entry.row.bundleMr.url,
    }
}
