import { draftStartedOn, type ShareDraft } from '@/lib/export/share-drafts'
import type { ExportSource } from '@/lib/export/sources'
import { DATASET_STATUS_LABELS } from '@/lib/ui/dataset-status'

/**
 * The choices of „Auswählen“, apart from the dropdown that shows them: pure,
 * so the words are tested without a browser (plan of 2026-10-18, section 3).
 *
 * The closed field shows only the dataset's name; the open list adds the
 * portal status and where the dataset came from, and a second, quieter line
 * for a share started in this browser.
 */
export interface SourceOption {
    value: string
    /** The portal's dataset name: all the closed field shows. */
    label: string
    /** The rest of the first line, „Freigegeben · hier angelegt“. */
    detail?: string
    /** The second line, „Angefangen am 12.10.“. */
    hint?: string
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

/** Sorted by name, as a person looks for one; each with what this browser knows about it. */
export function sourceOptions(sources: ExportSource[], drafts: ShareDraft[]): SourceOption[] {
    const started = new Map(drafts.map((draft) => [draft.datasetId, draft]))
    return [...sources]
        .sort((a, b) => a.name.localeCompare(b.name, 'de'))
        .map((source) => {
            // A status the portal adds later stays out rather than showing up as an English code word.
            const status = source.status ? DATASET_STATUS_LABELS[source.status] : undefined
            const detail = [status, originLabel(source.installed)].filter(Boolean).join(' · ')
            const draft = started.get(source.id)
            return {
                value: source.id,
                label: source.name,
                ...(detail ? { detail } : {}),
                ...(draft ? { hint: `Angefangen am ${draftStartedOn(draft)}` } : {}),
            }
        })
}
