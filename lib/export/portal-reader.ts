import { isCoreUrn, logicalUrn } from '@/lib/export/urn'

/**
 * Reads one dataset and everything hanging off it from the portal-backend —
 * the inverse of the install: pipelines with their models, the sources and
 * sinks they link, the structure versions those reference, and the mappings
 * the pipeline graphs name. Read with the USER's token, so the platform's own
 * permissions decide what may be exported; the marketplace adds no authority.
 *
 * Nothing here transforms: the snapshot is the instance's truth, minted URNs
 * and all. The package view is derived in transform.ts.
 */

export class PortalReadError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message)
        this.name = 'PortalReadError'
    }
}

export interface DatasetListing {
    id: string
    name: string
    description?: string
    status?: string
}

export interface SnapshotStructure {
    versionId: string
    dataStructureId: string
    name: string
    description?: string
    /** The versioned model URN the version pins. */
    modelUrn: string
    model: Record<string, unknown>
}

export interface SnapshotSource {
    id: string
    name: string
    description?: string
    connectorType: string
    configuration: Record<string, unknown>
    configurationUrn?: string
    structureVersionId?: string
}

export interface SnapshotSink {
    id: string
    name: string
    dataSinkType: string
    configuration: Record<string, unknown>
    configurationUrn?: string
    /** The structure the sink's `element` references, when the output carries the summary. */
    structureVersionId?: string
}

export interface SnapshotPipeline {
    id: string
    name: string
    description?: string
    model: Record<string, unknown>
    styles?: Record<string, unknown>
    dataSourceIds: string[]
    dataSinkIds: string[]
}

export interface SnapshotMapping {
    /** Logical URN the pipeline referenced (the instance's identity). */
    urn: string
    document: Record<string, unknown>
}

export interface InstanceSnapshot {
    dataset: { id: string; name: string; description?: string }
    pipelines: SnapshotPipeline[]
    sources: SnapshotSource[]
    sinks: SnapshotSink[]
    structures: SnapshotStructure[]
    mappings: SnapshotMapping[]
    /** What could not be resolved — surfaced in the preview, never silently dropped. */
    warnings: string[]
}

function apiBase(): string {
    return `${process.env.API_BASE_URL}:${process.env.API_PORT}`
}

async function getJson<T>(accessToken: string, path: string): Promise<T | undefined> {
    const response = await fetch(`${apiBase()}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
    }).catch((error) => {
        throw new PortalReadError(`Portal-Backend nicht erreichbar: ${String(error)}`, 0)
    })
    if (response.status === 404) return undefined
    if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as { detail?: string } | null
        throw new PortalReadError(
            problem?.detail ?? `${path}: ${response.status} ${response.statusText}`,
            response.status,
        )
    }
    return (await response.json()) as T
}

interface Page<T> {
    content?: T[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

export async function listDatasets(accessToken: string): Promise<DatasetListing[]> {
    const page = await getJson<Page<Record<string, unknown>>>(accessToken, '/v1/datasets?size=200')
    return (page?.content ?? []).map((row) => ({
        id: String(row.id),
        name: typeof row.name === 'string' ? row.name : String(row.id),
        description: typeof row.description === 'string' ? row.description : undefined,
        status: typeof row.dataSetStatus === 'string' ? row.dataSetStatus : undefined,
    }))
}

async function readStructureVersion(
    accessToken: string,
    dataStructureId: string,
    versionId: string,
): Promise<SnapshotStructure | undefined> {
    const dto = await getJson<Record<string, unknown>>(
        accessToken,
        `/v1/datastructures/${dataStructureId}/versions/${versionId}`,
    )
    if (!dto || !isRecord(dto.model) || typeof dto.modelUrn !== 'string') return undefined
    const parent = isRecord(dto.dataStructure) ? dto.dataStructure : {}
    const model = dto.model
    return {
        versionId,
        dataStructureId,
        name:
            (typeof parent.name === 'string' && parent.name) ||
            (typeof dto.modelName === 'string' && dto.modelName) ||
            (typeof model.title === 'string' && model.title) ||
            'Struktur',
        description: typeof dto.description === 'string' ? dto.description : undefined,
        modelUrn: dto.modelUrn,
        model,
    }
}

/**
 * Finds the version pinning a given (logical or versioned) model URN by
 * walking the instance's structures — the fallback for a mapping that names a
 * structure no source or sink of the dataset references. Bounded: the walk
 * stops after 200 structures, which is far beyond any instance today.
 */
async function findStructureByUrn(
    accessToken: string,
    urn: string,
): Promise<SnapshotStructure | undefined> {
    const wanted = logicalUrn(urn)
    const page = await getJson<Page<Record<string, unknown>>>(accessToken, '/v1/datastructures?size=200')
    for (const structure of page?.content ?? []) {
        const versions = await getJson<Page<Record<string, unknown>>>(
            accessToken,
            `/v1/datastructures/${structure.id}/versions?size=100`,
        )
        for (const version of versions?.content ?? []) {
            if (typeof version.modelUrn === 'string' && logicalUrn(version.modelUrn) === wanted) {
                return readStructureVersion(accessToken, String(structure.id), String(version.id))
            }
        }
    }
    return undefined
}

/** A DataStructureVersionSummaryDTO as the source and sink outputs embed it: id plus parent id. */
function versionSummary(value: unknown): { versionId: string; dataStructureId?: string } | undefined {
    if (!isRecord(value) || typeof value.id !== 'string') return undefined
    return {
        versionId: value.id,
        dataStructureId: typeof value.dataStructureId === 'string' ? value.dataStructureId : undefined,
    }
}

export async function readUseCase(accessToken: string, datasetId: string): Promise<InstanceSnapshot> {
    const warnings: string[] = []
    const dataset = await getJson<Record<string, unknown>>(accessToken, `/v1/datasets/${datasetId}`)
    if (!dataset) throw new PortalReadError(`Dataset ${datasetId} nicht gefunden`, 404)

    // Pipelines: the list carries summaries, the full model comes per pipeline.
    const pipelinePage = await getJson<Page<Record<string, unknown>>>(
        accessToken,
        `/v1/datasets/${datasetId}/pipelines?size=100`,
    )
    const pipelines: SnapshotPipeline[] = []
    for (const summary of pipelinePage?.content ?? []) {
        const dto = await getJson<Record<string, unknown>>(
            accessToken,
            `/v1/datasets/${datasetId}/pipelines/${summary.id}`,
        )
        if (!dto || !isRecord(dto.model)) {
            warnings.push(`Pipeline ${String(summary.name ?? summary.id)} hat kein Modell und wird ausgelassen`)
            continue
        }
        pipelines.push({
            id: String(dto.id),
            name: typeof dto.name === 'string' ? dto.name : `Pipeline ${pipelines.length + 1}`,
            description: typeof dto.description === 'string' ? dto.description : undefined,
            model: dto.model,
            styles: isRecord(dto.styles) ? dto.styles : undefined,
            dataSourceIds: Array.isArray(dto.dataSourceIds) ? dto.dataSourceIds.map(String) : [],
            dataSinkIds: Array.isArray(dto.dataSinkIds) ? dto.dataSinkIds.map(String) : [],
        })
    }

    // Structure versions to read, collected from the summaries the connector outputs embed.
    const wantedVersions = new Map<string, string | undefined>() // versionId → parent id

    const sinkPage = await getJson<Page<Record<string, unknown>>>(
        accessToken,
        `/v1/datasets/${datasetId}/datasinks?size=100`,
    )
    const sinks: SnapshotSink[] = (sinkPage?.content ?? []).map((dto, index) => {
        const configuration = isRecord(dto.configuration) ? dto.configuration : {}
        const summary = versionSummary(configuration.dataStructureVersion)
        if (summary) wantedVersions.set(summary.versionId, summary.dataStructureId)
        return {
            id: String(dto.id),
            name:
                (typeof dto.name === 'string' && dto.name) ||
                (typeof configuration.tableName === 'string' && configuration.tableName) ||
                `Senke ${index + 1}`,
            dataSinkType: typeof dto.dataSinkType === 'string' ? dto.dataSinkType : 'POSTGIS',
            configuration,
            configurationUrn: typeof dto.configurationUrn === 'string' ? dto.configurationUrn : undefined,
            structureVersionId: summary?.versionId,
        }
    })

    const sourceIds = new Set(pipelines.flatMap((pipeline) => pipeline.dataSourceIds))
    const sources: SnapshotSource[] = []
    for (const sourceId of sourceIds) {
        const dto = await getJson<Record<string, unknown>>(accessToken, `/v1/datasources/${sourceId}`)
        if (!dto) {
            warnings.push(`Datenquelle ${sourceId} ist verlinkt, aber nicht lesbar — ausgelassen`)
            continue
        }
        const summary = versionSummary(dto.dataStructureVersion)
        if (summary) wantedVersions.set(summary.versionId, summary.dataStructureId)
        sources.push({
            id: String(dto.id),
            name: typeof dto.name === 'string' ? dto.name : `Quelle ${sources.length + 1}`,
            description: typeof dto.description === 'string' ? dto.description : undefined,
            connectorType: typeof dto.connectorType === 'string' ? dto.connectorType : 'MQTT',
            configuration: isRecord(dto.configuration) ? dto.configuration : {},
            configurationUrn: typeof dto.configurationUrn === 'string' ? dto.configurationUrn : undefined,
            structureVersionId: summary?.versionId,
        })
    }

    const structures = new Map<string, SnapshotStructure>()
    for (const [versionId, dataStructureId] of wantedVersions) {
        const structure = dataStructureId
            ? await readStructureVersion(accessToken, dataStructureId, versionId)
            : undefined
        if (!structure) {
            warnings.push(`Strukturversion ${versionId} konnte nicht gelesen werden`)
            continue
        }
        structures.set(versionId, structure)
    }

    // Mappings: whatever the pipeline graphs reference by URN.
    const mappingUrns = new Set<string>()
    for (const pipeline of pipelines) {
        const nodes = Array.isArray(pipeline.model.nodes) ? pipeline.model.nodes : []
        for (const node of nodes) {
            if (isRecord(node) && isCoreUrn(node.mappingRef)) mappingUrns.add(node.mappingRef)
        }
    }
    const mappings: SnapshotMapping[] = []
    for (const urn of mappingUrns) {
        const document = await getJson<Record<string, unknown>>(
            accessToken,
            `/v1/mappings?urn=${encodeURIComponent(urn)}`,
        )
        if (!document) {
            warnings.push(`Mapping ${urn} ist referenziert, aber nicht lesbar — ausgelassen`)
            continue
        }
        mappings.push({ urn: logicalUrn(urn), document })
        // A mapping may name a structure no source or sink of this dataset references.
        for (const side of ['source', 'target'] as const) {
            const ref = document[side]
            if (!isCoreUrn(ref)) continue
            const known = [...structures.values()].some((s) => logicalUrn(s.modelUrn) === logicalUrn(ref))
            if (known) continue
            const found = await findStructureByUrn(accessToken, ref)
            if (found) structures.set(found.versionId, found)
            else warnings.push(`Mapping ${urn}: Struktur ${ref} ist auf dieser Instanz nicht auffindbar`)
        }
    }

    return {
        dataset: {
            id: String(dataset.id),
            name: typeof dataset.name === 'string' ? dataset.name : String(dataset.id),
            description: typeof dataset.description === 'string' ? dataset.description : undefined,
        },
        pipelines,
        sources,
        sinks,
        structures: [...structures.values()],
        mappings,
        warnings,
    }
}
