import { inProgressHref } from '@/lib/export/in-progress-items'
import { datasetStage, stageHint, versionsOf, type ListingFacts } from '@/lib/export/new-version'
import { draftStartedOn, type ShareDraft } from '@/lib/export/share-drafts'
import type { ExportSource } from '@/lib/export/sources'
import { DATASET_STATUS_LABELS } from '@/lib/ui/dataset-status'

/**
 * The choices of „Auswählen“, apart from the dropdown that shows them: pure,
 * so the words are tested without a browser (plan of 2026-10-18, section 3).
 *
 * The closed field shows only the dataset's name; the open list adds the
 * portal status and where the dataset came from, and a second, quieter line
 * for where it stands: a share started in this browser, or what the share
 * listing says (a busy dataset is greyed out).
 */
export interface SourceOption {
    value: string
    /** The portal's dataset name: all the closed field shows. */
    label: string
    /** The rest of the first line, „Freigegeben · hier angelegt“. */
    detail?: string
    /** The second line, „Angefangen am 12.10.“, „In Arbeit (1.1.0) - nicht wählbar“. */
    hint?: string
    /** Greyed out: something of it is in „In Arbeit“ (see `blockingRows`). */
    disabled?: boolean
    /** For a greyed-out one: its versions in progress and a link to the first, for the sentence under the field. */
    busy?: { versions: string; href: string }
}

/**
 * What the share listing said when the options were made. While `loading` or
 * `failed` nothing is greyed out: the server checks again on submit. Absent
 * where the person may not submit.
 */
export type ListingState = { state: 'loading' } | { state: 'failed' } | ({ state: 'read' } & ListingFacts)

/** The dataset and shared version the address names (`from=`): continuing that row does not grey the dataset out. */
export interface OpenedChoice {
    datasetId?: string
    from?: { version: string; slug?: string }
}

/**
 * Where a dataset came from, in the words agreed on 13 Oct (never "selbst
 * erstellt"). Nothing when the installations could not be read: a guess would
 * be wrong for every installed dataset at once.
 */
function originLabel(installed: boolean | undefined): string | undefined {
    if (installed === undefined) return undefined
    return installed ? 'aus dem Katalog installiert' : 'hier angelegt'
}

/**
 * Sorted by name, as a person looks for one. An open proposal greys a dataset
 * out even with a share started here; otherwise the started share's hint wins
 * over the listing's, as it is the person's own next step.
 */
export function sourceOptions(sources: ExportSource[], drafts: ShareDraft[], listing?: ListingState, opened: OpenedChoice = {}): SourceOption[] {
    const started = new Map(drafts.map((draft) => [draft.datasetId, draft]))
    return [...sources]
        .sort((a, b) => a.name.localeCompare(b.name, 'de'))
        .map((source) => {
            // A status the portal adds later stays out rather than showing up as an English code word.
            const status = source.status ? DATASET_STATUS_LABELS[source.status] : undefined
            const detail = [status, originLabel(source.installed)].filter(Boolean).join(' · ')
            const draft = started.get(source.id)
            const stage =
                listing?.state === 'read'
                    ? datasetStage(source, listing, { started: Boolean(draft), ...(opened.datasetId === source.id && opened.from ? { from: opened.from } : {}) })
                    : undefined
            const hint = stage?.kind === 'busy' ? stageHint(stage) : draft ? `Angefangen am ${draftStartedOn(draft)}` : stage && stageHint(stage)
            return {
                value: source.id,
                label: source.name,
                ...(detail ? { detail } : {}),
                ...(hint ? { hint } : {}),
                ...(stage?.kind === 'busy' ? { disabled: true, busy: { versions: versionsOf(stage.rows), href: inProgressHref(stage.rows[0].row) } } : {}),
            }
        })
}

/** The greyed-out options, for the sentence under the field (`BusySentence`). */
export function busyOptions(options: readonly SourceOption[]): (SourceOption & { busy: NonNullable<SourceOption['busy']> })[] {
    return options.filter((option): option is SourceOption & { busy: NonNullable<SourceOption['busy']> } => Boolean(option.disabled && option.busy))
}
