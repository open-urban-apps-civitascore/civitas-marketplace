import { inProgressHref } from '@/lib/export/in-progress-items'
import { datasetStage, stageHint, versionsOf, type ListingFacts } from '@/lib/export/new-version'
import { draftStartedOn, type ShareDraft } from '@/lib/export/share-drafts'
import type { ExportSource } from '@/lib/export/sources'
import { DATASET_STATUS_LABELS } from '@/lib/ui/dataset-status'

export interface SourceOption {
    value: string
    label: string
    detail?: string
    hint?: string
    disabled?: boolean
    busy?: { versions: string; href: string }
}

/** While `loading` or `failed` nothing is greyed out: the server checks again on submit. */
export type ListingState = { state: 'loading' } | { state: 'failed' } | ({ state: 'read' } & ListingFacts)

/** The address's dataset and version (`from=`): continuing that row does not grey the dataset out. */
export interface OpenedChoice {
    datasetId?: string
    from?: { version: string; slug?: string }
}

/** Nothing when the installations could not be read: a guess would be wrong for all of them at once. */
function originLabel(installed: boolean | undefined): string | undefined {
    if (installed === undefined) return undefined
    return installed ? 'aus dem Katalog installiert' : 'hier angelegt'
}

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

export function busyOptions(options: readonly SourceOption[]): (SourceOption & { busy: NonNullable<SourceOption['busy']> })[] {
    return options.filter((option): option is SourceOption & { busy: NonNullable<SourceOption['busy']> } => Boolean(option.disabled && option.busy))
}
