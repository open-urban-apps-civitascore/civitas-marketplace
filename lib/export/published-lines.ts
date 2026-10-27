import { changeNoteOf, inProgressHref, type ReasonLine } from '@/lib/export/in-progress-items'
import { ofUnknownInstance, type TabRow, type TurnedDown } from '@/lib/export/share-tabs'
import { newVersionHref } from '@/lib/export/wizard-address'
import { catalogEntryHref } from '@/lib/use-case-catalog/path'

/**
 * How one row of „Veröffentlicht“ reads: since when it is in the catalogue, who
 * submitted it, its Herausgeber, earlier versions, where to look at it, and the
 * way on. Pure, for the list and its tests.
 *
 * An older share whose README names no instance, while this one has a name,
 * gets only the catalogue link: nothing says this instance shared it. A change
 * the catalogue team did not take is a note, not a block: the version stays listed.
 */

export interface PublishedLine {
    title: string
    version: string
    /** „Seit 14.10. im Katalog · eingereicht von Ewa · Herausgeber: Open Urban Apps“, as far as it is known; „Instanz unbekannt“ last. */
    facts?: string
    /** „Frühere Versionen im Katalog: 1.0.0, 1.0.1“ */
    earlier?: string
    /** The note on a change to this version that the catalogue team did not take. */
    reasons?: ReasonLine[]
    /** „Im Katalog ansehen“: the entry's page, else the catalogue's list where the id is not known. */
    catalogHref: string
    /** „In GitLab ansehen“: the entry proposal that brought it in, else its package's. */
    gitlabHref?: string
    /** „Neue Version teilen“, or while a newer version is under way the link to its row in „In Arbeit“. */
    next?: { kind: 'new-version'; href: string } | { kind: 'newer'; version: string; href: string; declined?: TurnedDown }
}

export interface PublishedOptions {
    /** When the listing was read, in milliseconds: dates are told against it, so the line stays the same between renders. */
    now?: number
    /** This instance as the listing names it, for `ofUnknownInstance`. */
    instance?: string
}

/** Where „Im Katalog ansehen“ leads when the entry's id is not known. */
const CATALOGUE_PATH = '/use-cases'

const DAY = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' })
const DATE = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' })
const YEAR = new Intl.DateTimeFormat('de-DE', { year: 'numeric', timeZone: 'Europe/Berlin' })

/** „14.10.“ in the year of `now`, else with its year: an entry stays in the catalogue for years. Without `now`, always with it. */
function dayOf(time: number, now: number | undefined): string {
    return now !== undefined && YEAR.format(time) === YEAR.format(now) ? DAY.format(time) : DATE.format(time)
}

/** The row's own entry proposal that was merged: what brought this version into the catalogue. The listing keeps the newest first. */
function mergedEntryOf(tabbed: TabRow) {
    return tabbed.row.proposals?.find((proposal) => proposal.kind === 'catalog' && proposal.state === 'merged')
}

/** One row of „Veröffentlicht“ (see above). */
export function publishedLine(tabbed: TabRow, { now, instance }: PublishedOptions = {}): PublishedLine {
    const { row } = tabbed
    const entry = mergedEntryOf(tabbed)
    const listedAt = entry?.mergedAt ? Date.parse(entry.mergedAt) : NaN
    // Another instance's entry is counted, never listed here (`shareTabs`).
    const unknown = ofUnknownInstance(tabbed.origin, instance)
    const facts = [
        Number.isNaN(listedAt) ? undefined : `Seit ${dayOf(listedAt, now)} im Katalog`,
        row.proposedBy ? `eingereicht von ${row.proposedBy}` : undefined,
        row.catalog?.maintainer ? `Herausgeber: ${row.catalog.maintainer}` : undefined,
        unknown ? 'Instanz unbekannt' : undefined,
    ].filter(Boolean)
    const earlier = tabbed.listedEarlier.length ? `Frühere Versionen im Katalog: ${tabbed.listedEarlier.join(', ')}` : undefined
    const catalogHref = row.packageId ? catalogEntryHref(row.packageId) : CATALOGUE_PATH
    const newer = tabbed.newer
    // The dataset where the row names one: the wizard asks for another where it is not here (any more).
    const next: PublishedLine['next'] = newer
        ? {
              kind: 'newer',
              version: newer.version,
              href: inProgressHref({ targetKey: row.targetKey, slug: row.slug, version: newer.version }),
              ...(newer.declined ? { declined: newer.declined } : {}),
          }
        : { kind: 'new-version', href: newVersionHref({ ...(row.source?.id ? { datasetId: row.source.id } : {}), slug: row.slug, version: row.version }) }
    return {
        title: row.displayName,
        version: row.version,
        ...(facts.length ? { facts: facts.join(' · ') } : {}),
        ...(earlier ? { earlier } : {}),
        ...(tabbed.declinedChange ? { reasons: [changeNoteOf(row.version, tabbed.declinedChange)] } : {}),
        catalogHref,
        ...(unknown ? {} : { gitlabHref: entry?.url ?? row.bundleMr.url, next }),
    }
}
