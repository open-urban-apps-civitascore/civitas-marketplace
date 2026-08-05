import airQualityManifest from './air-quality-station/manifest.json'
import airQualityArtifact from './air-quality-station/artifact.schema.json'
import trafficManifest from './traffic-counting/manifest.json'
import trafficStructure from './traffic-counting/structure.artifact.schema.json'
import trafficSources from './traffic-counting/datasources.json'

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

/** A bundled data source, referencing its structure by CORE URN. */
export interface BundledDataSource {
    name: string
    description?: string
    dataStructureUrn: string
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
            ],
            dataSources: trafficSources as BundledDataSource[],
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
