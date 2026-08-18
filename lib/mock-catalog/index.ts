import airQualityManifest from './air-quality-station/manifest.json'
import airQualityArtifact from './air-quality-station/artifact.schema.json'
import trafficManifest from './traffic-counting/manifest.json'
import trafficStructure from './traffic-counting/structure.artifact.schema.json'
import trafficTargetStructure from './traffic-counting/structure.target.artifact.schema.json'
import trafficSources from './traffic-counting/datasources.json'
import trafficMapping from './traffic-counting/mapping.json'
import trafficPipeline from './traffic-counting/pipeline.json'

/**
 * Catalogue metadata for one installable entry — the "packaging". Mirrors the
 * manifest format decided for the GitLab catalogue, so swapping this mock for
 * fetched entries later changes only the data source, not the shape.
 *
 * `id`: for datastructure entries this IS the artifact's logical CORE URN.
 * Use cases have no platform identity yet (the install-registry gap), so they
 * carry a marketplace-owned urn in a distinct scheme — never a fake CORE URN.
 */
export interface CatalogManifest {
    id: string
    type: 'datastructure' | 'usecase'
    displayName: string
    description: string
    version: string
    maintainer: string
    license: string
    keywords: string[]
}

/** A bundled data structure: name + the opaque artifact (its `$id` is the identity). */
export interface BundledDataStructure {
    name: string
    description?: string
    model: Record<string, unknown>
}

/**
 * A bundled data source, referencing its structure by CORE URN. The connector
 * configuration matters beyond ingestion: only a configured source gets a
 * minted configuration URN, and only that URN lets a bundle pipeline
 * reference the source in its graph.
 */
export interface BundledDataSource {
    name: string
    description?: string
    dataStructureUrn: string
    connectorType?: 'MQTT' | 'SQL'
    configuration?: Record<string, unknown>
}

/**
 * A bundled mapping. Unlike a structure, whose identity travels inside the
 * artifact as `$id`, a mapping carries its URN in the envelope: Model Forge
 * stamps `id` on every write, so an authored one would be overwritten. Without
 * `mappingUrn` the platform mints a random identity and every re-install would
 * duplicate the mapping instead of resolving to the same one.
 */
export interface BundledMapping {
    mappingUrn: string
    name: string
    description?: string
    document: Record<string, unknown>
}

/**
 * A bundled data sink. Carries no URN at all: a sink has no portable identity —
 * the receiving instance mints one — so the `name` is a bundle-local handle
 * that pipelines in the same bundle reference via `sinkRef`. The
 * configuration's `element` names the target structure by its logical CORE
 * URN; the platform resolves and rewrites it to the installed version.
 */
export interface BundledDataSink {
    name: string
    dataSinkType: 'POSTGIS' | 'FROST'
    configuration: Record<string, unknown>
}

/**
 * A bundled pipeline. The graph references its bundle siblings by NAME
 * (sourceRef/sinkRef/mappingRef): minted URNs differ per instance, so names
 * are the only identities a bundle can author. Values starting with `urn:`
 * pass through verbatim for the advanced case of referencing something
 * already installed.
 */
export interface BundledPipeline {
    name: string
    description?: string
    model: Record<string, unknown>
}

export interface DataStructureEntry {
    manifest: CatalogManifest & { type: 'datastructure' }
    artifact: Record<string, unknown>
}

export interface UseCaseEntry {
    manifest: CatalogManifest & { type: 'usecase' }
    bundle: {
        dataStructures: BundledDataStructure[]
        dataSources: BundledDataSource[]
        mappings: BundledMapping[]
        dataSinks: BundledDataSink[]
        pipelines: BundledPipeline[]
    }
}

export type CatalogEntry = DataStructureEntry | UseCaseEntry

export const mockCatalog: CatalogEntry[] = [
    {
        manifest: airQualityManifest as DataStructureEntry['manifest'],
        artifact: airQualityArtifact,
    },
    {
        manifest: trafficManifest as UseCaseEntry['manifest'],
        bundle: {
            dataStructures: [
                {
                    name: 'Verkehrszählung',
                    description: 'Zählstellen und Zählungen im Geräteformat des Simulators',
                    model: trafficStructure,
                },
                {
                    name: 'Verkehrsmessung',
                    description: 'Normalisiertes Zielformat, gegen das Auswertungen laufen',
                    model: trafficTargetStructure,
                },
            ],
            dataSources: trafficSources as BundledDataSource[],
            mappings: [trafficMapping as BundledMapping],
            dataSinks: [
                {
                    name: 'Verkehrsmessung-Tabelle',
                    dataSinkType: 'POSTGIS',
                    configuration: {
                        tableName: 'verkehrsmessung',
                        // Logical URN of the TARGET structure — the platform resolves
                        // it to the installed version's model URN.
                        element: 'urn:core:city:openurbanapps:datastructure:mobility:verkehrsmessung:default',
                    },
                },
            ],
            pipelines: [trafficPipeline as BundledPipeline],
        },
    },
]

export function findCatalogEntry(id: string): CatalogEntry | undefined {
    return mockCatalog.find((entry) => entry.manifest.id === id)
}

/** Type guard: TypeScript cannot narrow on the nested manifest.type discriminant. */
export function isDataStructureEntry(entry: CatalogEntry): entry is DataStructureEntry {
    return entry.manifest.type === 'datastructure'
}
