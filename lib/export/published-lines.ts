import { changeNoteOf, inProgressHref, type ReasonLine } from '@/lib/export/in-progress-items'
import { ofUnknownInstance, type TabRow, type TurnedDown } from '@/lib/export/share-tabs'
import { newVersionHref } from '@/lib/export/wizard-address'
import { catalogEntryHref } from '@/lib/use-case-catalog/path'

export interface PublishedLine {
    title: string
    version: string
    facts?: string
    earlier?: string
    reasons?: ReasonLine[]
    catalogHref: string
    gitlabHref?: string
    next?: { kind: 'new-version'; href: string } | { kind: 'newer'; version: string; href: string; declined?: TurnedDown }
}

export interface PublishedOptions {
    /** When the listing was read, so the line stays the same between renders. */
    now?: number
    instance?: string
}

const CATALOGUE_PATH = '/use-cases'

const DAY = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' })
const DATE = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' })
const YEAR = new Intl.DateTimeFormat('de-DE', { year: 'numeric', timeZone: 'Europe/Berlin' })

/** With its year unless in `now`'s year: an entry stays in the catalogue for years. */
function dayOf(time: number, now: number | undefined): string {
    return now !== undefined && YEAR.format(time) === YEAR.format(now) ? DAY.format(time) : DATE.format(time)
}

/** The merged entry proposal that listed this version; the listing keeps the newest first. */
function mergedEntryOf(tabbed: TabRow) {
    return tabbed.row.proposals?.find((proposal) => proposal.kind === 'catalog' && proposal.state === 'merged')
}

export function publishedLine(tabbed: TabRow, { now, instance }: PublishedOptions = {}): PublishedLine {
    const { row } = tabbed
    const entry = mergedEntryOf(tabbed)
    const listedAt = entry?.mergedAt ? Date.parse(entry.mergedAt) : NaN
    // An unknown instance gets only the catalogue link: nothing says this instance shared it.
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
    // The wizard asks for another dataset where this one is gone.
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
