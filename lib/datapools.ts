import { getAccessToken } from '@/lib/session'

export interface DatapoolOption {
    id: string
    name: string
    description?: string
}

export interface DatapoolListing {
    pools: DatapoolOption[]
    /**
     * Set when the list could not be read. An empty list then does not mean that the instance
     * has no datapools, and the install dialog must not say so.
     */
    problem?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The datapools the signed-in user can read, by name. An install puts the sources and the dataset
 * of a use case into one of them, and which one is instance knowledge no package can carry.
 *
 * Read with the USER's token: the platform decides which pools this person sees, and it decides
 * again, at install time, whether they may install into the one they picked.
 */
export async function fetchDatapools(): Promise<DatapoolListing> {
    // Outside the try block: a missing session ends in a redirect, which travels as an exception
    // and must not be mistaken for an unreachable backend.
    const accessToken = await getAccessToken()

    try {
        // One large page: the default is 20, and a pool that silently drops out of the list
        // after the 20th would be a pool nobody can install into.
        const res = await fetch(
            `${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/datapools?size=200`,
            {
                headers: { Authorization: `Bearer ${accessToken}` },
                cache: 'no-store',
            },
        )
        if (!res.ok) {
            return {
                pools: [],
                problem:
                    res.status === 403
                        ? 'Ihrer Rolle fehlt das Leserecht auf Datenpools (DATAPOOL_READ).'
                        : `Das Portal-Backend antwortet auf die Datenpool-Abfrage mit ${res.status}.`,
            }
        }

        const page = (await res.json()) as { content?: unknown[] }
        const pools = (page.content ?? []).flatMap((row): DatapoolOption[] => {
            if (!isRecord(row) || typeof row.id !== 'string') return []
            return [
                {
                    id: row.id,
                    name: typeof row.name === 'string' && row.name ? row.name : row.id,
                    ...(typeof row.description === 'string' && row.description
                        ? { description: row.description }
                        : {}),
                },
            ]
        })
        return { pools: pools.sort((a, b) => a.name.localeCompare(b.name, 'de')) }
    } catch {
        return { pools: [], problem: 'Das Portal-Backend ist nicht erreichbar.' }
    }
}
