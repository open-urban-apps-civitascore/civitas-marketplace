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

describe('simulation validation', () => {
    const traffic = mockPackages.find(
        (pkg) => pkg.manifest.id === 'urn:openurbanapps:usecase:verkehrszaehlung',
    )!
    const SIM_FILE = 'zaehlstellen.simulation.json'

    const withSimulation = (mutate: (simulation: Record<string, unknown>) => void) => {
        const files = structuredClone(traffic.files)
        mutate(files[SIM_FILE] as Record<string, unknown>)
        return () => assembleCatalogEntry(traffic.manifest, readerFor(files))
    }

    it('assembles the fixture simulations and exposes them on the bundle', () => {
        const entry = assembleCatalogEntry(traffic.manifest, readerFor(traffic.files))
        if (isDataStructureEntry(entry)) throw new Error('expected a use case')
        expect(entry.bundle.simulations).toHaveLength(1)
        expect(entry.bundle.simulations[0].streams.length).toBeGreaterThanOrEqual(3)
    })

    it('refuses a sourceRef that matches no bundled datasource', () => {
        expect(withSimulation((s) => { s.sourceRef = 'Gibt es nicht' })).toThrow(
            /matches no bundled datasource/,
        )
    })

    it('refuses a messageClass pointer that does not resolve', () => {
        expect(withSimulation((s) => { s.messageClass = '#/$defs/Nirwana' })).toThrow(
            /does not resolve/,
        )
    })

    it('refuses a field that is not a property of the message class', () => {
        expect(
            withSimulation((s) => {
                const stream = (s.streams as Record<string, unknown>[])[0]
                ;(stream.fields as Record<string, unknown>).tippfehler = { kind: 'now' }
            }),
        ).toThrow(/'tippfehler' is not a property/)
    })

    it('refuses a stream that omits a required field of the message class', () => {
        expect(
            withSimulation((s) => {
                const stream = (s.streams as Record<string, unknown>[])[0]
                delete (stream.fields as Record<string, unknown>).vehicleCount
            }),
        ).toThrow(/does not produce required field 'vehicleCount'/)
    })

    it('refuses an unknown generator kind and a generator missing its operands', () => {
        expect(
            withSimulation((s) => {
                const stream = (s.streams as Record<string, unknown>[])[0]
                ;(stream.fields as Record<string, unknown>).direction = { kind: 'wuerfeln' }
            }),
        ).toThrow(/unknown generator kind/)
        expect(
            withSimulation((s) => {
                const stream = (s.streams as Record<string, unknown>[])[0]
                ;(stream.fields as Record<string, unknown>).avgSpeedKmh = { kind: 'randomWalk', min: 1 }
            }),
        ).toThrow(/missing 'max'/)
    })

    it('checks nested requireds of objects a dotted path steps into', () => {
        const air = mockPackages.find(
            (pkg) => pkg.manifest.id === 'urn:openurbanapps:usecase:luftqualitaet-sta',
        )!
        const files = structuredClone(air.files)
        const simulation = files['luftmessung.simulation.json'] as Record<string, unknown>
        const stream = (simulation.streams as Record<string, unknown>[])[0]
        // Producing pm25.value while dropping pm25.unit ships a message the
        // structure itself declares invalid (Measurement requires both).
        delete (stream.fields as Record<string, unknown>)['pm25.unit']
        expect(() => assembleCatalogEntry(air.manifest, readerFor(files))).toThrow(
            /does not produce required field 'pm25.unit'/,
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
