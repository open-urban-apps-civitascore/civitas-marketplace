/**
 * The datapool a dataset belongs to, read from the dataset itself.
 *
 * The install record does not carry the pool, and it should not: a dataset can
 * be moved to another pool after the install, and the dataset is where the
 * platform keeps the answer. So the pages that link an installed use case to
 * its pool ask the dataset (`GET /v1/datasets/{id}`), with the user's token.
 * The same answer carries the release status, which the dashboard hint needs.
 *
 * No session import on purpose: the caller passes the token, and the module
 * stays testable without the framework.
 */

export interface DatapoolRef {
    id: string
    name: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** What the pages of an installed use case read from its dataset. */
export interface DatasetOverview {
    datapool: DatapoolRef | null
    /**
     * The platform's `dataSetStatus`: DRAFT, READY (staged) or AVAILABLE
     * (released). Only a released dataset has its sinks rolled out, so only
     * then does the table a dashboard reads exist.
     */
    status?: string
    /**
     * The platform's `pendingSagaType`: the operation running on the dataset
     * right now (CREATE after a release, UPDATE, UNRELEASE, DELETE). A release
     * sets AVAILABLE at once, so only this tells that its pipeline does not run
     * yet.
     */
    pendingOperation?: string
}

function datapoolOf(dataset: Record<string, unknown>): DatapoolRef | null {
    if (!isRecord(dataset.datapool)) return null
    const { id, name } = dataset.datapool
    if (typeof id !== 'string' || !id) return null
    return { id, name: typeof name === 'string' && name ? name : id }
}

/**
 * Null when the dataset cannot be read (gone, or the role lacks DATASET_READ)
 * or when the backend is unreachable. The callers then draw nothing; an error
 * box for a missing link or hint would be out of proportion.
 */
export async function fetchDatasetOverview(
    dataSetId: string,
    accessToken: string,
): Promise<DatasetOverview | null> {
    try {
        const res = await fetch(
            `${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/datasets/${encodeURIComponent(dataSetId)}`,
            {
                headers: { Authorization: `Bearer ${accessToken}` },
                cache: 'no-store',
            },
        )
        if (!res.ok) return null

        const dataset: unknown = await res.json()
        if (!isRecord(dataset)) return null
        return {
            datapool: datapoolOf(dataset),
            ...(typeof dataset.dataSetStatus === 'string' ? { status: dataset.dataSetStatus } : {}),
            ...(typeof dataset.pendingSagaType === 'string' && dataset.pendingSagaType
                ? { pendingOperation: dataset.pendingSagaType }
                : {}),
        }
    } catch {
        return null
    }
}

/** The pool alone; null also when the dataset has no pool. */
export async function fetchDatapoolOfDataset(
    dataSetId: string,
    accessToken: string,
): Promise<DatapoolRef | null> {
    return (await fetchDatasetOverview(dataSetId, accessToken))?.datapool ?? null
}
