import type { ExportInstallation } from '@/lib/export/sources'
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
    /**
     * The structure the sink's `element` references: from the version summary a
     * PostGIS output embeds, or found by URN for a FROST output, which names only `element`.
     */
    structureVersionId?: string
    /** The platform had no name for it: `name` was made up here ("Senke 2") and travels as such. */
    unnamed?: boolean
}

export interface SnapshotPipeline {
    id: string
    name: string
    /** The platform had no name for it: `name` was made up here ("Pipeline 2") and travels as such. */
    unnamed?: boolean
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

/** A named API of the dataset (`namedApis` of the dataset output), e.g. an OWS map service. */
export interface SnapshotApi {
    name: string
    slug: string
    standard: string
    version?: string
    description?: string
}

export interface SnapshotStyle {
    id: string
    name: string
    sldContent: string
}

/** A map layer as the platform returns it: its sink and styles by id, which the package names by title and name. */
export interface SnapshotLayer {
    id: string
    layerName: string
    title?: string
    description?: string
    keywords: string[]
    attribute: string[]
    geometryColumnRef?: string
    cqlFilter?: string
    dataSinkId?: string
    defaultStyleId?: string
    alternativeStyleIds: string[]
    crs?: string
    nativeBoundingBox?: Record<string, unknown>
    latLonBoundingBox?: Record<string, unknown>
}

export interface InstanceSnapshot {
    dataset: { id: string; name: string; description?: string }
    pipelines: SnapshotPipeline[]
    sources: SnapshotSource[]
    sinks: SnapshotSink[]
    structures: SnapshotStructure[]
    mappings: SnapshotMapping[]
    /** The geo members: named APIs, and the styles and layers that publish the dataset's sinks. */
    apis?: SnapshotApi[]
    styles?: SnapshotStyle[]
    layers?: SnapshotLayer[]
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
    last?: boolean
    totalPages?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

async function listPages<T>(accessToken: string, path: string): Promise<T[]> {
    const rows: T[] = []
    for (let page = 0; ; page++) {
        const result = await getJson<Page<T>>(accessToken, `${path}?size=200&page=${page}`)
        const content = result?.content ?? []
        rows.push(...content)
        if (!content.length || result?.last === true || (result?.totalPages !== undefined
            ? page + 1 >= result.totalPages : result?.last === undefined)) break
    }
    return rows
}

export async function listExportInstallations(accessToken: string): Promise<ExportInstallation[]> {
    return listPages<ExportInstallation>(accessToken, '/v1/installations')
}

export async function listDatasets(accessToken: string): Promise<DatasetListing[]> {
    const rows = await listPages<Record<string, unknown>>(accessToken, '/v1/datasets')
    return rows.map((row) => ({
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

/** A structure the search should find, and every place that needs it, so a miss is reported where it matters. */
interface StructureWant {
    /** The URN as the first referrer names it, versioned or logical. */
    ref: string
    where: string[]
}

/** Version reads one structure search may spend. Far beyond any instance today, and reaching it is reported. */
const MAX_SEARCH_READS = 300

/**
 * Finds the versions pinning model URNs that no connector summary resolved:
 * the `element` of a FROST sink, whose output carries no version summary, and
 * mapping sides. The platform has no lookup by URN and refuses the list of a
 * structure's versions with 405, so this walks the structure list and reads
 * the versions its rows name one by one, checking each against every wanted
 * URN at once and stopping when all are found. `attempted` spans the whole
 * export, so no version is read twice. Read failures become warnings: an
 * unreadable structure costs the export one member, not the whole inventory.
 */
async function searchStructures(
    accessToken: string,
    wanted: Map<string, StructureWant>,
    attempted: Set<string>,
    warnings: string[],
): Promise<Map<string, SnapshotStructure>> {
    const found = new Map<string, SnapshotStructure>() // logical URN → structure
    const pending = new Map(wanted)
    if (!pending.size) return found
    const report = (reason: string) => {
        for (const want of pending.values()) {
            for (const where of want.where) warnings.push(`${where}: Struktur ${want.ref} ${reason}`)
        }
    }

    let rows: Record<string, unknown>[]
    try {
        rows = await listPages<Record<string, unknown>>(accessToken, '/v1/datastructures')
    } catch (error) {
        if (!(error instanceof PortalReadError)) throw error
        report(`konnte nicht gesucht werden: ${error.message}`)
        return found
    }

    // A versioned reference should get the version it pins; another version of its structure is the fallback.
    const fallback = new Map<string, SnapshotStructure>()
    const unreadable: string[] = []
    let reads = 0
    let bounded = false
    walk: for (const row of rows) {
        const versions = Array.isArray(row.dataStructureVersions) ? row.dataStructureVersions : []
        for (const version of versions) {
            if (!isRecord(version) || typeof version.id !== 'string' || attempted.has(version.id)) continue
            if (reads >= MAX_SEARCH_READS) {
                bounded = true
                break walk
            }
            attempted.add(version.id)
            reads++
            let structure: SnapshotStructure | undefined
            try {
                structure = await readStructureVersion(accessToken, String(row.id), version.id)
            } catch (error) {
                if (!(error instanceof PortalReadError)) throw error
                unreadable.push(`${version.id} (${error.message})`)
                continue
            }
            if (!structure) continue
            const logical = logicalUrn(structure.modelUrn)
            const want = pending.get(logical)
            if (!want) continue
            if (structure.modelUrn === want.ref || logicalUrn(want.ref) === want.ref) {
                found.set(logical, structure)
                pending.delete(logical)
                fallback.delete(logical)
                if (!pending.size) return found
            } else if (!fallback.has(logical)) {
                fallback.set(logical, structure)
            }
        }
    }
    for (const [logical, structure] of fallback) {
        found.set(logical, structure)
        pending.delete(logical)
    }
    if (!pending.size) return found
    // The unreadable versions may have been the wanted ones, so a miss names them.
    const count = unreadable.length === 1 ? 'eine Strukturversion war' : `${unreadable.length} Strukturversionen waren`
    const unread = unreadable.length ? ` - ${count} nicht lesbar: ${unreadable.slice(0, 3).join(', ')}` : ''
    if (bounded) {
        report(`wurde in den ersten ${MAX_SEARCH_READS} Strukturversionen nicht gefunden - Suche abgebrochen${unread}`)
    } else if (unread) {
        report(`wurde nicht gefunden${unread}`)
    } else {
        report('ist auf dieser Instanz nicht auffindbar')
    }
    return found
}

/**
 * A DataStructureVersionSummaryDTO as the source and sink outputs embed it. Usable
 * only with its parent id, because a version is read under its structure's path.
 */
function versionSummary(value: unknown): { versionId: string; dataStructureId: string } | undefined {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.dataStructureId !== 'string') {
        return undefined
    }
    return { versionId: value.id, dataStructureId: value.dataStructureId }
}

const optionalString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() ? value : undefined

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : [])

/**
 * The dataset's named APIs from its own output, which lists them in every
 * status. The discovery endpoint `/datasets/{id}/apis` would answer an empty
 * list for a draft, and a draft is a fine thing to share.
 */
function namedApisOf(dataset: Record<string, unknown>): SnapshotApi[] {
    const rows = Array.isArray(dataset.namedApis) ? dataset.namedApis : []
    return rows.flatMap((row) => {
        if (!isRecord(row) || !optionalString(row.slug) || !optionalString(row.standard)) return []
        const slug = row.slug as string
        return [
            {
                name: optionalString(row.name) ?? slug,
                slug,
                standard: row.standard as string,
                version: optionalString(row.version),
                description: optionalString(row.description),
            },
        ]
    })
}

/**
 * The dataset's styles and layers. An instance whose platform predates them
 * answers 404 (an empty list here) or refuses; that costs the export its map,
 * not the whole package, so a refusal becomes a warning.
 */
async function readGeoMembers(
    accessToken: string,
    datasetId: string,
    warnings: string[],
): Promise<{ styles: SnapshotStyle[]; layers: SnapshotLayer[] }> {
    const read = async (kind: 'styles' | 'layers') => {
        try {
            return await listPages<Record<string, unknown>>(accessToken, `/v1/datasets/${datasetId}/${kind}`)
        } catch (error) {
            if (!(error instanceof PortalReadError)) throw error
            warnings.push(`${kind === 'styles' ? 'Stile' : 'Kartenebenen'} konnten nicht gelesen werden: ${error.message}`)
            return []
        }
    }
    const styles = (await read('styles')).flatMap((dto) =>
        optionalString(dto.name) && optionalString(dto.sldContent)
            ? [{ id: String(dto.id), name: dto.name as string, sldContent: dto.sldContent as string }]
            : [],
    )
    const layers = (await read('layers')).flatMap((dto): SnapshotLayer[] => {
        const layerName = optionalString(dto.layerName)
        if (!layerName) return []
        return [
            {
                id: String(dto.id),
                layerName,
                title: optionalString(dto.title),
                description: optionalString(dto.description),
                keywords: stringList(dto.keywords),
                attribute: stringList(dto.attribute),
                geometryColumnRef: optionalString(dto.geometryColumnRef),
                cqlFilter: optionalString(dto.cqlFilter),
                dataSinkId: optionalString(dto.dataSinkId),
                defaultStyleId: optionalString(dto.defaultStyleId),
                alternativeStyleIds: stringList(dto.alternativeStyleIds),
                crs: optionalString(dto.crs),
                nativeBoundingBox: isRecord(dto.nativeBoundingBox) ? dto.nativeBoundingBox : undefined,
                latLonBoundingBox: isRecord(dto.latLonBoundingBox) ? dto.latLonBoundingBox : undefined,
            },
        ]
    })
    return { styles, layers }
}

const DATASET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

export function isSafeDatasetId(datasetId: string): boolean {
    return DATASET_ID.test(datasetId)
}

export async function readUseCase(accessToken: string, datasetId: string): Promise<InstanceSnapshot> {
    if (!isSafeDatasetId(datasetId)) {
        throw new PortalReadError(`Ungültige Datensatz-Kennung: ${datasetId}`, 400)
    }
    const warnings: string[] = []
    const dataset = await getJson<Record<string, unknown>>(accessToken, `/v1/datasets/${datasetId}`)
    if (!dataset) throw new PortalReadError(`Datensatz ${datasetId} nicht gefunden`, 404)

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
            ...(typeof dto.name === 'string' ? {} : { unnamed: true }),
            description: typeof dto.description === 'string' ? dto.description : undefined,
            model: dto.model,
            styles: isRecord(dto.styles) ? dto.styles : undefined,
            dataSourceIds: Array.isArray(dto.dataSourceIds) ? dto.dataSourceIds.map(String) : [],
            dataSinkIds: Array.isArray(dto.dataSinkIds) ? dto.dataSinkIds.map(String) : [],
        })
    }

    // Structure versions to read, collected from the summaries the connector outputs embed.
    const wantedVersions = new Map<string, string>() // versionId → parent id
    // Connectors that name their structure only by URN; they get their version once the search has found it.
    const byElement: { connector: { structureVersionId?: string }; ref: string; where: string }[] = []

    const sinkPage = await getJson<Page<Record<string, unknown>>>(
        accessToken,
        `/v1/datasets/${datasetId}/datasinks?size=100`,
    )
    const sinks: SnapshotSink[] = (sinkPage?.content ?? []).map((dto, index) => {
        const configuration = isRecord(dto.configuration) ? dto.configuration : {}
        const summary = versionSummary(configuration.dataStructureVersion)
        if (summary) wantedVersions.set(summary.versionId, summary.dataStructureId)
        const given = (typeof dto.name === 'string' && dto.name) || (typeof configuration.tableName === 'string' && configuration.tableName)
        const sink: SnapshotSink = {
            id: String(dto.id),
            name: given || `Senke ${index + 1}`,
            ...(given ? {} : { unnamed: true }),
            dataSinkType: typeof dto.dataSinkType === 'string' ? dto.dataSinkType : 'POSTGIS',
            configuration,
            configurationUrn: typeof dto.configurationUrn === 'string' ? dto.configurationUrn : undefined,
            structureVersionId: summary?.versionId,
        }
        // The FROST output carries only `element`; the platform resolves the version for PostGIS alone.
        if (!summary && isCoreUrn(configuration.element)) {
            byElement.push({ connector: sink, ref: configuration.element, where: `Senke ${sink.name}` })
        }
        return sink
    })

    const sourceIds = new Set(pipelines.flatMap((pipeline) => pipeline.dataSourceIds))
    const sources: SnapshotSource[] = []
    for (const sourceId of sourceIds) {
        const dto = await getJson<Record<string, unknown>>(accessToken, `/v1/datasources/${sourceId}`)
        if (!dto) {
            warnings.push(`Datenquelle ${sourceId} ist verlinkt, aber nicht lesbar - ausgelassen`)
            continue
        }
        const summary = versionSummary(dto.dataStructureVersion)
        if (summary) wantedVersions.set(summary.versionId, summary.dataStructureId)
        const configuration = isRecord(dto.configuration) ? dto.configuration : {}
        const source: SnapshotSource = {
            id: String(dto.id),
            name: typeof dto.name === 'string' ? dto.name : `Quelle ${sources.length + 1}`,
            description: typeof dto.description === 'string' ? dto.description : undefined,
            connectorType: typeof dto.connectorType === 'string' ? dto.connectorType : 'MQTT',
            configuration,
            configurationUrn: typeof dto.configurationUrn === 'string' ? dto.configurationUrn : undefined,
            structureVersionId: summary?.versionId,
        }
        // The output has no `element` field of its own, but an unlinked source may still name one in its document.
        if (!summary && isCoreUrn(configuration.element)) {
            byElement.push({ connector: source, ref: configuration.element, where: `Datenquelle ${source.name}` })
        }
        sources.push(source)
    }

    const structures = new Map<string, SnapshotStructure>()
    // Every version this export tried to read, so the search below never reads one twice.
    const attempted = new Set<string>()
    for (const [versionId, dataStructureId] of wantedVersions) {
        attempted.add(versionId)
        let structure: SnapshotStructure | undefined
        try {
            structure = await readStructureVersion(accessToken, dataStructureId, versionId)
        } catch (error) {
            if (!(error instanceof PortalReadError)) throw error
            warnings.push(`Strukturversion ${versionId} konnte nicht gelesen werden: ${error.message}`)
            continue
        }
        if (!structure) {
            warnings.push(`Strukturversion ${versionId} konnte nicht gelesen werden`)
            continue
        }
        structures.set(versionId, structure)
    }
    const knownStructure = (ref: string): SnapshotStructure | undefined =>
        [...structures.values()].find((s) => logicalUrn(s.modelUrn) === logicalUrn(ref))

    // Whatever is still unknown is searched for in one walk, keyed by logical URN.
    const wantedStructures = new Map<string, StructureWant>()
    const wantStructure = (ref: string, where: string) => {
        if (knownStructure(ref)) return
        const want = wantedStructures.get(logicalUrn(ref)) ?? { ref, where: [] }
        want.where.push(where)
        wantedStructures.set(logicalUrn(ref), want)
    }
    for (const { ref, where } of byElement) wantStructure(ref, where)

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
            `/v1/datasets/${datasetId}/mappings?urn=${encodeURIComponent(urn)}`,
        )
        if (!document) {
            warnings.push(`Mapping ${urn} ist referenziert, aber nicht lesbar - ausgelassen`)
            continue
        }
        mappings.push({ urn: logicalUrn(urn), document })
        // A mapping may name a structure no source or sink of this dataset references.
        for (const side of ['source', 'target'] as const) {
            const ref = document[side]
            if (isCoreUrn(ref)) wantStructure(ref, `Mapping ${urn}`)
        }
    }

    const searched = await searchStructures(accessToken, wantedStructures, attempted, warnings)
    for (const structure of searched.values()) structures.set(structure.versionId, structure)
    for (const { connector, ref } of byElement) {
        connector.structureVersionId = knownStructure(ref)?.versionId
    }

    const { styles, layers } = await readGeoMembers(accessToken, datasetId, warnings)

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
        apis: namedApisOf(dataset),
        styles,
        layers,
        warnings,
    }
}
