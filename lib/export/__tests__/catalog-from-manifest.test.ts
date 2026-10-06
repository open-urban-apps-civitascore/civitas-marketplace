import { describe, expect, it } from 'vitest'

import { buildCatalogEntry, catalogInputFromManifest, type CatalogEntryInput } from '@/lib/export/catalog-entry'
import type { ExportMetadata } from '@/lib/export/metadata'
import type { InstanceSnapshot } from '@/lib/export/portal-reader'
import { transformSnapshot } from '@/lib/export/transform'

const snapshot: InstanceSnapshot = {
    dataset: { id: 'local', name: 'Bäume' },
    structures: [],
    sources: [],
    sinks: [],
    mappings: [],
    pipelines: [],
    warnings: [],
}
const metadata: ExportMetadata = {
    themes: ['umwelt-klima'],
    contact: { email: 'amt@stadt.example' },
    implementation: { collaboration: { wanted: false } },
}
const form = {
    publisher: 'stadt',
    slug: 'baeume',
    version: '1.0.0',
    domain: 'environment',
    displayName: 'Bäume',
    description: 'Stadtbäume',
    maintainer: 'Stadt',
    license: 'EUPL-1.2',
    keywords: ['baum', 'kataster'],
    metadata,
}
const location = { repoUrl: 'https://gitlab.example/group/packages', path: 'packages/baeume', commitSha: 'ABC123' }

describe('catalogInputFromManifest', () => {
    it('builds from the exported manifest the same entry the form would have built', () => {
        const pkg = transformSnapshot(snapshot, {
            ...form,
            provenance: { datasetId: 'local', datasetName: 'Bäume', exportedAt: '2026-10-06' },
        })
        const input = catalogInputFromManifest(pkg.files['core-ir/manifest.json'], location)
        expect(typeof input).toBe('object')

        const fromForm = buildCatalogEntry({
            id: 'urn:stadt:usecase:baeume',
            displayName: form.displayName,
            description: form.description,
            version: form.version,
            maintainer: form.maintainer,
            license: form.license,
            keywords: form.keywords,
            metadata,
            ...location,
        })
        expect(buildCatalogEntry(input as CatalogEntryInput)).toEqual(fromForm)
    })

    it('does not let a manifest award itself a review', () => {
        const manifest = JSON.stringify({
            id: 'urn:stadt:usecase:baeume',
            displayName: 'Bäume',
            description: 'Stadtbäume',
            version: '1.0.0',
            maintainer: 'Stadt',
            license: 'EUPL-1.2',
            curation: { tier: 'verified' },
        })
        const input = catalogInputFromManifest(manifest, location) as CatalogEntryInput
        expect(buildCatalogEntry(input)).not.toHaveProperty('curation')
    })

    it('names what a manifest is missing', () => {
        expect(catalogInputFromManifest(JSON.stringify({ id: 'urn:stadt:usecase:baeume' }), location)).toMatch(
            /displayName/,
        )
        expect(catalogInputFromManifest('not json', location)).toMatch(/kein gültiges JSON/)
    })
})
