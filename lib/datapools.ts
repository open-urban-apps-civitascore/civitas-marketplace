import { describeDatapoolCreateFailure, type FailureDescription } from '@/lib/install-payload'
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

export type DatapoolCreation =
    | { ok: true; pool: DatapoolOption }
    | { ok: false; failure: FailureDescription & { httpStatus: number } }

/**
 * Creates a datapool for an install that asked for a new one, with the USER's token: the platform
 * decides whether this person may create pools (in its standard roles only the Data Architect
 * may), and the install then goes into the new pool as into any other.
 */
export async function createDatapool(name: string, description: string): Promise<DatapoolCreation> {
    // Outside the try block, for the same reason as above.
    const accessToken = await getAccessToken()

    let res: Response
    try {
        res = await fetch(`${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/datapools`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description }),
            cache: 'no-store',
        })
    } catch {
        return {
            ok: false,
            failure: {
                status: 'error',
                detail: 'Datenpool nicht angelegt, nichts installiert: Das Portal-Backend ist nicht erreichbar.',
                httpStatus: 0,
            },
        }
    }
    if (res.status !== 201) {
        const failure = describeDatapoolCreateFailure(res.status, res.statusText, await res.text().catch(() => ''))
        return { ok: false, failure: { ...failure, httpStatus: res.status } }
    }

    const created: unknown = await res.json().catch(() => null)
    if (!isRecord(created) || typeof created.id !== 'string') {
        return {
            ok: false,
            failure: {
                status: 'error',
                detail: `Datenpool „${name}“ angelegt, aber die Antwort nennt keine ID. Nichts installiert; der Pool lässt sich im Portal löschen.`,
                httpStatus: res.status,
            },
        }
    }
    return { ok: true, pool: { id: created.id, name: typeof created.name === 'string' && created.name ? created.name : name } }
}

/**
 * Removes a datapool again; true when it is gone, an already absent one included. The install uses
 * it for a pool it has just created and could not fill: the platform deletes a pool only while no
 * dataset and no data source belongs to it, which is exactly that state.
 */
export async function deleteDatapool(id: string): Promise<boolean> {
    const accessToken = await getAccessToken()
    try {
        const res = await fetch(
            `${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/datapools/${encodeURIComponent(id)}`,
            {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${accessToken}` },
                cache: 'no-store',
            },
        )
        return res.ok || res.status === 404
    } catch {
        return false
    }
}
