/**
 * The datapool a dataset belongs to, read from the dataset itself.
 *
 * The install record does not carry the pool, and it should not: a dataset can
 * be moved to another pool after the install, and the dataset is where the
 * platform keeps the answer. So the pages that link an installed use case to
 * its pool ask the dataset (`GET /v1/datasets/{id}`), with the user's token.
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

/**
 * Null when the dataset cannot be read (gone, or the role lacks DATASET_READ),
 * when it has no pool, or when the backend is unreachable. The callers draw a
 * link when there is one and nothing when there is none; an error box for a
 * missing link would be out of proportion.
 */
export async function fetchDatapoolOfDataset(
    dataSetId: string,
    accessToken: string,
): Promise<DatapoolRef | null> {
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
        if (!isRecord(dataset) || !isRecord(dataset.datapool)) return null
        const { id, name } = dataset.datapool
        if (typeof id !== 'string' || !id) return null
        return { id, name: typeof name === 'string' && name ? name : id }
    } catch {
        return null
    }
}
