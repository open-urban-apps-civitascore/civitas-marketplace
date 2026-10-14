import { Cpu, ExternalLink } from 'lucide-react'

import { Chips } from '@/components/catalog/chip'
import { Code } from '@/components/catalog/code'
import { IconTile } from '@/components/ui/icon-tile'
import { Field, FieldList, Panel } from '@/components/ui/layout'
import type { CatalogSummary } from '@/lib/catalog/types'
import { FIELD_LABELS } from '@/lib/catalog/vocabulary'

const DATE = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'Europe/Berlin' })

/**
 * The technical and formal facts of an entry, the clickdummy's
 * `TechnicalFacts`: one panel with a two-column field list, so every value
 * sits on one axis across the full width.
 *
 * "Quelle" names the release a reader recognises and links the repository;
 * what an install fetches is the commit behind it. Without a pin the row goes:
 * an entry with no fixed state is not installable at all.
 */
export function TechnicalFacts({ entry }: { entry: CatalogSummary }) {
    const stack = entry.implementation?.stack ?? []
    const reference = entry.implementation?.reference
    const pin = entry.deploymentRef
    const curation = entry.curation
    // "v1.1.3" under Quelle already says "1.1.3"; the version gets its own row only when it says something else.
    const versionInSource = pin?.releaseTag === entry.version || pin?.releaseTag === `v${entry.version}`

    return (
        <Panel title="Technische Eckdaten" icon={<IconTile icon={Cpu} tone="usecase" />}>
            <FieldList layout="columns">
                {stack.length > 0 && (
                    <Field layout="columns" label={FIELD_LABELS.stack}>
                        <Chips items={stack} />
                    </Field>
                )}
                <Field layout="columns" label="Lizenz">
                    <span className="font-mono text-xs">{entry.license}</span>
                </Field>
                {!versionInSource && (
                    <Field layout="columns" label="Gelistete Version">
                        <span className="font-mono text-xs">{entry.version}</span>
                    </Field>
                )}
                {pin && (
                    <Field layout="columns" label="Quelle">
                        {/* The mock catalogue's fixtures have no repository to link. */}
                        {pin.url.startsWith('https://') ? (
                            <a
                                href={pin.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                            >
                                {pin.releaseTag ?? pin.ref.slice(0, 12)}
                                <ExternalLink aria-hidden className="size-3" />
                            </a>
                        ) : (
                            <span className="font-mono text-xs">{pin.releaseTag ?? pin.ref}</span>
                        )}
                    </Field>
                )}
                {reference && (
                    <Field layout="columns" label={FIELD_LABELS.reference}>
                        <a
                            href={reference.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                        >
                            {reference.source ?? 'Zur Quelle'}
                            <ExternalLink aria-hidden className="size-3" />
                        </a>
                    </Field>
                )}
                {curation && (
                    <Field layout="columns" label="Geprüft von">
                        {curation.reviewedBy}
                        <span className="ml-1 text-xs text-muted-foreground">({formatDate(curation.reviewedAt)})</span>
                    </Field>
                )}
                <Field layout="columns" label="Katalog-ID">
                    <Code>{entry.id}</Code>
                </Field>
                {entry.keywords.length > 0 && (
                    <Field layout="columns" label={FIELD_LABELS.keywords}>
                        <Chips items={entry.keywords} />
                    </Field>
                )}
            </FieldList>
        </Panel>
    )
}

/** "2026-10-01" or a full timestamp, as a German date; the raw text when it is neither. */
function formatDate(value: string): string {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : DATE.format(date)
}
