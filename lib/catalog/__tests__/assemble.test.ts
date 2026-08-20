import { describe, expect, it } from 'vitest'

import { assembleCatalogEntry, CatalogIntegrityError, parsePackageManifest } from '@/lib/catalog/assemble'
import { isDataStructureEntry } from '@/lib/catalog/types'
import { mockPackages } from '@/lib/mock-catalog'

const readerFor = (files: Record<string, Record<string, unknown>>) => (file: string) => {
    const content = files[file]
    if (!content) throw new CatalogIntegrityError(`no fixture file '${file}'`)
    return content
}

describe('assembleCatalogEntry', () => {
    it('assembles every bundled fixture package without errors', () => {
        for (const pkg of mockPackages) {
            const entry = assembleCatalogEntry(pkg.manifest, readerFor(pkg.files))
            expect(entry.manifest.id).toBe(pkg.manifest.id)
        }
    })

    it('derives structure names from the schema title (single source of truth)', () => {
        const traffic = mockPackages.find(
            (pkg) => pkg.manifest.id === 'urn:openurbanapps:usecase:verkehrszaehlung',
        )!
        const entry = assembleCatalogEntry(traffic.manifest, readerFor(traffic.files))
        expect(isDataStructureEntry(entry)).toBe(false)
        if (!isDataStructureEntry(entry)) {
            expect(entry.bundle.dataStructures.map((structure) => structure.name)).toEqual([
                'Verkehrszählung',
                'Verkehrsmessung (Zielformat)',
            ])
            expect(entry.bundle.mappings[0].mappingUrn).toMatch(/^urn:core:standard:/)
            expect(entry.bundle.pipelines[0].name).toBe('Zählung zu Messung')
        }
    })

    it('refuses a datastructure entry whose artifact $id does not match the entry id', () => {
        const airQuality = mockPackages.find((pkg) => pkg.manifest.type === 'datastructure')!
        const files = structuredClone(airQuality.files)
        const [file] = Object.keys(files)
        files[file] = { ...files[file], $id: 'urn:core:standard:openurbanapps:datastructure:x:y:z' }
        expect(() => assembleCatalogEntry(airQuality.manifest, readerFor(files))).toThrow(
            CatalogIntegrityError,
        )
    })

    it('refuses a package with a missing member file', () => {
        const traffic = mockPackages.find(
            (pkg) => pkg.manifest.id === 'urn:openurbanapps:usecase:verkehrszaehlung',
        )!
        const files = structuredClone(traffic.files)
        delete files['zaehlung-zu-messung.mapping.json']
        expect(() => assembleCatalogEntry(traffic.manifest, readerFor(files))).toThrow(
            CatalogIntegrityError,
        )
    })
})

describe('parsePackageManifest', () => {
    it('accepts every bundled fixture manifest', () => {
        for (const pkg of mockPackages) {
            expect(() => parsePackageManifest(pkg.manifest, pkg.manifest.id)).not.toThrow()
        }
    })

    it('refuses a manifest without members', () => {
        const withoutMembers: Record<string, unknown> = { ...mockPackages[0].manifest }
        delete withoutMembers.members
        expect(() => parsePackageManifest(withoutMembers, 'test')).toThrow(CatalogIntegrityError)
    })

    it('refuses an unknown entry type', () => {
        expect(() =>
            parsePackageManifest({ ...mockPackages[0].manifest, type: 'plugin' }, 'test'),
        ).toThrow(CatalogIntegrityError)
    })
})
