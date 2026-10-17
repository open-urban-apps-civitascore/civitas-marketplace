import type { DatasetOverview } from '@/lib/datapool-of-dataset'

/**
 * Why an uninstall would be refused right now, said BEFORE the click.
 *
 * The platform's UninstallGuard refuses for more reasons than this page can
 * see: an operation in progress, a dataset with infrastructure after its
 * release was taken back, an artifact something else uses. The dataset's
 * status is the one it can see, and the most common one. Everything else
 * still arrives as the server's 409 after the click, so the server stays the
 * authority and this only spares the user the round trip.
 */
export interface UninstallBlocker {
    /** What is in the way, in one sentence. */
    reason: string
    /** What to do about it in the portal. */
    remedy: string
    /** What the remedy costs, when it costs something. */
    warning?: string
}

export function uninstallBlocker(dataset: DatasetOverview | null): UninstallBlocker | null {
    if (dataset?.status !== 'AVAILABLE') return null
    return {
        reason: 'Der Datensatz ist im Portal freigegeben.',
        remedy: 'Zum Deinstallieren dort erst die Freigabe zurücknehmen und dann den Datensatz löschen.',
        // Taking the release back keeps the stored data; deleting the dataset
        // drops its tables and its FROST project for good.
        warning: 'Beim Löschen gehen die bisher gespeicherten Daten des Datensatzes verloren.',
    }
}
