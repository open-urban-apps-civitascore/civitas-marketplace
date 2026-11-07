import { DECLINE_DAYS, declineOf } from '@/lib/export/declines'
import { changeNoteOf, inProgressHref, type ReasonLine } from '@/lib/export/in-progress-items'
import { proposedByOther } from '@/lib/export/merge-request-text'
import type { SharedPackageRow } from '@/lib/export/share-listing'
import { ofUnknownInstance, type TabRow, type TurnedDown } from '@/lib/export/share-tabs'
import { textEditHref, type TextEditRef } from '@/lib/export/text-edit'
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
    textEdit?: { kind: 'offer'; href: string } | { kind: 'open'; ref: TextEditRef; iid: number; byOther?: string }
}

export interface PublishedOptions {
    /** When the listing was read, so the line stays the same between renders. */
    now?: number
    instance?: string
    /** Who is looking, so a colleague's open proposal gets named. */
    person?: string
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

function textChangeNote({ textChange: change, version }: SharedPackageRow, now: number | undefined): ReasonLine | undefined {
    if (change?.state === 'opened') {
        return {
            text: `Textänderung in Prüfung (Vorschlag !${change.iid}). Bis dahin zeigt der Katalog den bisherigen Text, und eine neue Version geht erst danach.`,
            link: { label: 'Vorschlag ansehen', href: change.url, heard: ` (!${change.iid})` },
        }
    }
    if (!change?.closedAt || change.closedByBot || change.withdrawnBy) return undefined
    const days = now === undefined ? 0 : (now - Date.parse(change.closedAt)) / (24 * 60 * 60 * 1000)
    return days <= DECLINE_DAYS ? changeNoteOf(version, declineOf(change)) : undefined
}

function textEditOf({ row, origin, newer }: TabRow, person: string | undefined): PublishedLine['textEdit'] {
    if (origin !== 'this') return undefined
    const ref: TextEditRef = { targetKey: row.targetKey, slug: row.slug, version: row.version }
    const change = row.textChange
    if (change?.state === 'opened') return { kind: 'open', ref, iid: change.iid, ...(proposedByOther(change.proposedBy, person) ? { byOther: change.proposedBy } : {}) }
    return newer && !newer.declined ? undefined : { kind: 'offer', href: textEditHref(ref) }
}

export function publishedLine(tabbed: TabRow, { now, instance, person }: PublishedOptions = {}): PublishedLine {
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
    const reasons = [tabbed.declinedChange && changeNoteOf(row.version, tabbed.declinedChange), textChangeNote(row, now)].filter((reason) => reason !== undefined)
    const textEdit = textEditOf(tabbed, person)
    const offersNext = !(next.kind === 'new-version' && row.textChange?.state === 'opened')
    return {
        title: row.displayName,
        version: row.version,
        ...(facts.length ? { facts: facts.join(' · ') } : {}),
        ...(earlier ? { earlier } : {}),
        ...(reasons.length ? { reasons } : {}),
        catalogHref,
        ...(unknown ? {} : { gitlabHref: entry?.url ?? row.bundleMr.url, ...(offersNext ? { next } : {}) }),
        ...(textEdit ? { textEdit } : {}),
    }
}
