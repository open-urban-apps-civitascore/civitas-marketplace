import { describe, expect, it } from 'vitest'

import { assembleCatalogEntry } from '@/lib/catalog/assemble'
import { summarisePackage } from '@/lib/catalog/package-contents'
import { isDataStructureEntry, type UseCaseEntry } from '@/lib/catalog/types'
import { mockPackages } from '@/lib/mock-catalog'

function fixture(id: string): UseCaseEntry {
    const pkg = mockPackages.find((candidate) => candidate.manifest.id === id)!
    const entry = assembleCatalogEntry(pkg.manifest, (file) => pkg.files[file]!)
    if (isDataStructureEntry(entry)) throw new Error('not a use case')
    return entry
}

describe('summarisePackage', () => {
    const contents = summarisePackage(fixture('urn:openurbanapps:usecase:jungbaum-bewaesserung'))

    it('lists the parts in the order the data passes them, named as the package names them', () => {
        expect(contents.parts.map((part) => [part.label, part.names.length])).toEqual([
            ['Datenquellen', 2],
            ['Mappings', 2],
            ['Datenstrukturen', 4],
            ['Pipelines', 2],
            ['Datensenken', 2],
        ])
        expect(contents.parts.every((part) => part.names.every((name) => name.length > 0))).toBe(true)
    })

    it('tells that demo data comes along, stream by stream', () => {
        expect(contents.demoStreams.length).toBeGreaterThan(0)
    })

    it('has no interfaces when the package declares none', () => {
        expect(contents.apis).toEqual([])
    })
})
