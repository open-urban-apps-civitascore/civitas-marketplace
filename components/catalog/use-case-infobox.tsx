import type { ReactNode } from 'react'
import { ClipboardList, ExternalLink, Handshake, PlayCircle } from 'lucide-react'

import { TierExplainer } from '@/components/catalog/curation-tier'
import { IconTile } from '@/components/ui/icon-tile'
import { Eyebrow, Field, FieldList, NeutralBadge } from '@/components/ui/layout'
import type { CatalogSummary } from '@/lib/catalog/types'
import { buildUseCaseListing } from '@/lib/use-case-catalog/listing'
import {
    collaborationLabel,
    COST_BAND_LABELS,
    COST_BAND_SHORT,
    EFFORT_BAND_LABELS,
    EFFORT_BAND_SHORT,
    FIELD_LABELS,
    USE_CASE_STATUS_HINTS,
    USE_CASE_STATUS_LABELS,
    type CostBand,
} from '@/lib/catalog/vocabulary'

/**
 * The Steckbrief: the facts that decide an entry, in one box beside the text,
 * the clickdummy's `UseCaseInfobox` (Wikipedia infobox, Ewa 2026-09-22).
 *
 * Short on purpose. Each group answers one question: how sound is this, who
 * stands behind it, what does it cost. The group labels are eyebrows, not
 * headings, so they label a region without competing with the box's title.
 * Not here, because they are known elsewhere on the page or decide nothing:
 * the themes (chips above the title), licence, version and source (technical
 * details).
 *
 * The clickdummy's Nachnutzer and Aktualität stay out until the catalogue
 * carries them: an empty row there would only say that we do not know.
 *
 * No actions: the install button stays in the hero, where it is still near the
 * top on a phone (this column drops below the text under `lg`).
 */
export function UseCaseInfobox({
    entry,
    demoData,
    className,
}: {
    entry: CatalogSummary
    /** Whether the package ships demo data; unknown (a described entry, an unreadable package) leaves the row out. */
    demoData?: boolean
    className?: string
}) {
    const { implementation, curation, contact } = entry
    const resources = implementation?.resources
    const status = implementation?.status
    const operator = implementation?.operator
    const hasCosts = Boolean(resources?.totalCost || resources?.setupCost || resources?.runningCost || resources?.effort || resources?.funding || resources?.note)

    return (
        <aside aria-label="Steckbrief" className={`rounded-lg border bg-card ${className ?? ''}`}>
            <div className="flex items-center gap-2 border-b px-5 py-3">
                {/* Identity, not a judgement: green marks a use case, on the tile only (design system §4.2). */}
                <IconTile icon={ClipboardList} tone="usecase" />
                <h2 className="text-sm font-semibold text-foreground">Auf einen Blick</h2>
            </div>

            <Group label="Einordnung">
                {curation ? (
                    <div className="pb-1">
                        <TierExplainer tier={curation.tier} notes={curation.notes} />
                    </div>
                ) : (
                    <Field label="Siegel">
                        <span className="font-normal text-muted-foreground">Noch ohne Siegel</span>
                    </Field>
                )}
                {status && (
                    <Field label={FIELD_LABELS.status} hint={USE_CASE_STATUS_HINTS[status]}>
                        {USE_CASE_STATUS_LABELS[status]}
                    </Field>
                )}
                {/* Whether it can be tried before any own data exists. Only the fact:
                    what the demo data holds is in its panel, so the box does not repeat it. */}
                {demoData !== undefined && (
                    <Field label="Ausprobieren">
                        {demoData ? (
                            <span className="inline-flex items-center gap-1.5">
                                <PlayCircle aria-hidden className="size-3.5 shrink-0" />
                                Kommt mit Demo-Daten
                            </span>
                        ) : (
                            <span className="font-normal text-muted-foreground">Nur mit eigenen Daten</span>
                        )}
                    </Field>
                )}
            </Group>

            <Group label="Wer dahintersteht" last={!hasCosts}>
                <Field label={FIELD_LABELS.operator}>{operator ?? entry.maintainer}</Field>
                {/* Whoever publishes the package, or keeps a described entry, when that is someone else. */}
                {operator && operator !== entry.maintainer && (
                    <Field label={buildUseCaseListing(entry).publisherRole}>{entry.maintainer}</Field>
                )}
                <List label={FIELD_LABELS.stakeholders} items={implementation?.parties?.stakeholders} />
                <List label={FIELD_LABELS.serviceProviders} items={implementation?.parties?.serviceProviders} />
                {contact && (
                    <Field label={FIELD_LABELS.contact}>
                        {contact.name && <span className="block">{contact.name}</span>}
                        {contact.role && <span className="block text-xs font-normal text-muted-foreground">{contact.role}</span>}
                        {contact.email && (
                            <a href={`mailto:${contact.email}`} className="block text-xs font-normal text-primary underline-offset-2 hover:underline">
                                {contact.email}
                            </a>
                        )}
                        {contact.url && (
                            <a
                                href={contact.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-normal text-primary underline-offset-2 hover:underline"
                            >
                                Zur Ansprechstelle
                                <ExternalLink aria-hidden className="size-3 shrink-0" />
                            </a>
                        )}
                    </Field>
                )}
            </Group>

            {/* Build and run costs apart: a project budget can invest once, the running cost has to be carried every year. */}
            {hasCosts && (
                <Group label="Kosten und Aufwand" last>
                    <Band label={FIELD_LABELS.totalCost} value={resources?.totalCost} />
                    <Band label={FIELD_LABELS.setupCost} value={resources?.setupCost} />
                    <Band label={FIELD_LABELS.runningCost} value={resources?.runningCost} />
                    {resources?.effort && (
                        <Field label={FIELD_LABELS.effort} hint={resources.note}>
                            <NeutralBadge short={EFFORT_BAND_SHORT[resources.effort]}>{EFFORT_BAND_LABELS[resources.effort]}</NeutralBadge>
                        </Field>
                    )}
                    {/* The note explains the effort; without an effort band it stands on its own. */}
                    {resources?.note && !resources.effort && <Field label={FIELD_LABELS.note}>{resources.note}</Field>}
                    {resources?.funding && <Field label={FIELD_LABELS.funding}>{resources.funding}</Field>}
                </Group>
            )}

            {implementation?.collaboration && (
                <div className="border-t bg-muted/40 px-5 py-3">
                    <p className="flex items-start gap-1.5 text-xs font-semibold text-foreground">
                        <Handshake aria-hidden className="mt-px size-3.5 shrink-0" />
                        <span>
                            {FIELD_LABELS.collaboration}: {collaborationLabel(implementation.collaboration.wanted)}
                        </span>
                    </p>
                    {implementation.collaboration.wanted && implementation.collaboration.seeking && (
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{implementation.collaboration.seeking}</p>
                    )}
                </div>
            )}
        </aside>
    )
}

/** One group of the box: an eyebrow, its fields, a rule below unless it is the last. */
function Group({ label, last = false, children }: { label: string; last?: boolean; children: ReactNode }) {
    return (
        <section className={last ? 'px-5 pb-4' : 'border-b px-5 pb-4'}>
            <Eyebrow className="pb-2 pt-4">{label}</Eyebrow>
            <FieldList>{children}</FieldList>
        </section>
    )
}

function List({ label, items }: { label: string; items: string[] | undefined }) {
    if (!items?.length) return null
    return (
        <Field label={label}>
            <ul className="flex flex-col gap-0.5 font-normal">
                {items.map((item) => (
                    <li key={item}>{item}</li>
                ))}
            </ul>
        </Field>
    )
}

/** A cost band: its letter as a neutral badge, the amount as words. */
function Band({ label, value }: { label: string; value: CostBand | undefined }) {
    if (!value) return null
    return (
        <Field label={label}>
            <NeutralBadge short={COST_BAND_SHORT[value]}>{COST_BAND_LABELS[value]}</NeutralBadge>
        </Field>
    )
}
