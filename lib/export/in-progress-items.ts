import type { ShareDraft } from '@/lib/export/share-drafts'
import type { SharedPackageRow } from '@/lib/export/share-listing'
import type { ShareProgress } from '@/lib/export/share-stages'
import { rowOutcome, rowProgress, TAB_OF } from '@/lib/export/share-tabs'

/** What "In Arbeit" lists, apart from how it shows it. Pure, for the component and its tests. */

export type InProgressItem =
    | { kind: 'draft'; key: string; draft: ShareDraft; available: boolean }
    | { kind: 'shared'; key: string; row: SharedPackageRow; progress: ShareProgress }

export { rowProgress }

/** The person's own move: a draft, a version whose state could not be read, or a stage that is theirs. */
export function isMine(item: InProgressItem): boolean {
    return item.kind === 'draft' || item.row.problem !== undefined || item.progress.turn === 'you'
}

/**
 * The drafts, and the shared versions that belong in „In Arbeit“ by the tab
 * rules (`share-tabs.ts`): waiting for a review, for the catalogue entry, for
 * a removal, or needing a look. What is in the catalogue, replaced,
 * withdrawn, removed or taken out stays in "Geteilte Pakete". The person's
 * own moves first, then what waits on others; within each, the order given
 * (newest first).
 */
export function inProgressItems(drafts: ShareDraft[], available: ReadonlySet<string>, rows: SharedPackageRow[]): InProgressItem[] {
    const shared = rows.flatMap((row): InProgressItem[] => {
        const progress = rowProgress(row)
        return TAB_OF[rowOutcome(row, progress)] === 'in-progress' ? [{ kind: 'shared', key: row.key, row, progress }] : []
    })
    return [
        ...drafts.map((draft): InProgressItem => ({ kind: 'draft', key: `draft:${draft.datasetId}`, draft, available: available.has(draft.datasetId) })),
        ...shared,
    ].sort((a, b) => Number(isMine(b)) - Number(isMine(a)))
}

/** The first `limit` items unless all are wanted, how many stay out of sight, and how many of those are the person's move. */
export function compactList<T>(items: T[], expanded: boolean, limit: number, mine: (item: T) => boolean) {
    const shown = expanded ? items : items.slice(0, limit)
    const rest = items.slice(shown.length)
    return { shown, more: rest.length, moreMine: rest.filter(mine).length }
}
