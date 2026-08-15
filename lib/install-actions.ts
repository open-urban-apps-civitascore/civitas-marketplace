'use server'

import { findCatalogEntry, isDataStructureEntry, type UseCaseEntry } from '@/lib/mock-catalog'
import { getAccessToken } from '@/lib/session'

export interface InstallResult {
    status: 'created' | 'conflict' | 'invalid' | 'error'
    /** Human-readable summary (created) or backend message (ProblemDetail.detail). */
    detail: string
    httpStatus: number
}

interface DataSetImportSummary {
    installationId?: string
    dataSetId?: string
    dataSetName?: string
    dataStructures?: { name: string; urn: string; action: string }[]
    dataSources?: { name: string }[]
    mappings?: { name: string; urn: string; action: string }[]
}

/**
 * Installs a catalogue entry through the REAL install path: user token → APISIX
 * gateway → the type's import endpoint. Only the payload source is mocked;
 * this action is the production install call.
 */
export async function installEntry(
    _prev: InstallResult | null,
    formData: FormData,
): Promise<InstallResult> {
    const entryId = formData.get('entryId')
    const entry = typeof entryId === 'string' ? findCatalogEntry(entryId) : undefined
    if (!entry) {
        return {
            status: 'error',
            detail: `Unbekannter Katalog-Eintrag: ${String(entryId)}`,
            httpStatus: 0,
        }
    }

    if (isDataStructureEntry(entry)) {
        const res = await postImport('/v1/imports/datastructures', {
            name: entry.manifest.displayName,
            description: entry.manifest.description,
            model: entry.artifact,
        })
        if (res.ok) {
            const body = (await res.response.json()) as { modelUrn?: string }
            return { status: 'created', detail: body.modelUrn ?? entry.manifest.id, httpStatus: 201 }
        }
        return res.failure
    }

    const res = await postImport('/v1/imports/datasets', buildUseCaseBundleBody(entry))
    if (res.ok) {
        const body = (await res.response.json()) as DataSetImportSummary
        const structures = (body.dataStructures ?? [])
            .map((s) => `${s.urn} (${s.action})`)
            .join(', ')
        const sources = body.dataSources?.length ?? 0
        const mappings = (body.mappings ?? []).map((m) => `${m.name} (${m.action})`).join(', ')
        const mappingSegment = mappings ? ` · Mappings: ${mappings}` : ''
        const installation = body.installationId ? ` · Installation ${body.installationId}` : ''
        return {
            status: 'created',
            detail: `Dataset „${body.dataSetName ?? entry.manifest.displayName}" angelegt · Strukturen: ${structures || '—'} · ${sources} Quelle(n)${mappingSegment}${installation}`,
            httpStatus: 201,
        }
    }
    return res.failure
}

// "build" prefix: dodges the react-hooks lint rule that treats any use*
// function as a hook.
function buildUseCaseBundleBody(entry: UseCaseEntry) {
    return {
        name: entry.manifest.displayName,
        description: entry.manifest.description,
        // Bundle identity for the backend's install provenance — recorded
        // verbatim in the installation header, never interpreted.
        bundleUrn: entry.manifest.id,
        bundleVersion: entry.manifest.version,
        dataStructures: entry.bundle.dataStructures.map((structure) => ({
            name: structure.name,
            description: structure.description,
            model: structure.model,
        })),
        dataSources: entry.bundle.dataSources.map((source) => ({
            name: source.name,
            description: source.description,
            dataStructureUrn: source.dataStructureUrn,
        })),
        mappings: entry.bundle.mappings.map((mapping) => ({
            name: mapping.name,
            description: mapping.description,
            mappingUrn: mapping.mappingUrn,
            document: mapping.document,
        })),
    }
}

type PostResult = { ok: true; response: Response } | { ok: false; failure: InstallResult }

async function postImport(path: string, body: unknown): Promise<PostResult> {
    const accessToken = await getAccessToken()

    const response = await fetch(`${process.env.API_BASE_URL}:${process.env.API_PORT}${path}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
    })

    if (response.status === 201) return { ok: true, response }

    // Backend errors arrive as RFC-9457 ProblemDetail: `detail` carries the
    // actionable message our own guards wrote (400 guards, 409 turnstile).
    const problem = (await response.json().catch(() => null)) as { detail?: string } | null
    const detail = problem?.detail ?? `${response.status} ${response.statusText}`
    const status =
        response.status === 409 ? 'conflict' : response.status === 400 ? 'invalid' : 'error'
    return { ok: false, failure: { status, detail, httpStatus: response.status } }
}
