'use server'

import { findCatalogEntry } from '@/lib/mock-catalog'
import { getAccessToken } from '@/lib/session'

export interface InstallResult {
    status: 'created' | 'conflict' | 'invalid' | 'error'
    /** Backend message (ProblemDetail.detail) or created model URN. */
    detail: string
    httpStatus: number
}

/**
 * Installs a mock catalogue entry through the REAL install path: user token →
 * APISIX gateway → POST /v1/imports/datastructures. Only the payload source is
 * mocked; this action is the production install call.
 */
export async function installDataStructure(
    _prev: InstallResult | null,
    formData: FormData,
): Promise<InstallResult> {
    const entryId = formData.get('entryId')
    const entry = typeof entryId === 'string' ? findCatalogEntry(entryId) : undefined
    if (!entry) {
        return { status: 'error', detail: `Unbekannter Katalog-Eintrag: ${String(entryId)}`, httpStatus: 0 }
    }

    const accessToken = await getAccessToken()

    const res = await fetch(
        `${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/imports/datastructures`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: entry.manifest.displayName,
                description: entry.manifest.description,
                model: entry.artifact,
            }),
            cache: 'no-store',
        },
    )

    if (res.status === 201) {
        const body = (await res.json()) as { modelUrn?: string }
        return { status: 'created', detail: body.modelUrn ?? entry.manifest.id, httpStatus: 201 }
    }

    // Backend errors arrive as RFC-9457 ProblemDetail: `detail` carries the
    // actionable message our own guards wrote (400 $id guard, 409 turnstile).
    const problem = (await res.json().catch(() => null)) as { detail?: string } | null
    const detail = problem?.detail ?? `${res.status} ${res.statusText}`
    if (res.status === 409) return { status: 'conflict', detail, httpStatus: 409 }
    if (res.status === 400) return { status: 'invalid', detail, httpStatus: 400 }
    return { status: 'error', detail, httpStatus: res.status }
}
