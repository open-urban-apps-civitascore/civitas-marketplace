import airQualityManifest from './air-quality-station/manifest.json'
import airQualityArtifact from './air-quality-station/artifact.schema.json'

/**
 * Catalogue metadata for one installable entry — the "packaging". Mirrors the
 * manifest format decided for the GitLab catalogue, so swapping this mock for
 * fetched entries later changes only the data source, not the shape.
 */
export interface CatalogManifest {
    /** The artifact's logical CORE URN — one identity through catalogue → import → registry. */
    id: string
    type: 'datastructure'
    displayName: string
    description: string
    version: string
    maintainer: string
    license: string
    keywords: string[]
}

/**
 * One mock catalogue entry: manifest (packaging) + artifact (opaque cargo).
 * The artifact is passed to the import endpoint byte-identical — the
 * marketplace never modifies it (the `$id` inside is the identity the
 * registry types and versions by).
 */
export interface CatalogEntry {
    manifest: CatalogManifest
    artifact: Record<string, unknown>
}

export const mockCatalog: CatalogEntry[] = [
    {
        manifest: airQualityManifest as CatalogManifest,
        artifact: airQualityArtifact,
    },
]

export function findCatalogEntry(id: string): CatalogEntry | undefined {
    return mockCatalog.find((entry) => entry.manifest.id === id)
}
