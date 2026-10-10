import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { assembleCatalogEntry } from '@/lib/catalog/assemble'
import type { InstanceSnapshot } from '@/lib/export/portal-reader'
import { draftSimulation, type DraftGenerator } from '@/lib/export/simulation-draft'
import { transformSnapshot, type ExportedPackage, type ExportOptions } from '@/lib/export/transform'

/**
 * A drafted simulation is only worth shipping if the catalogue accepts it, so
 * every test that exports a package also assembles it with the catalogue's
 * own checks (field paths, required coverage, topicBase against the
 * subscription). validator-roundtrip.test.ts runs the Python twin of those
 * checks against an export that now carries a draft as well.
 */

const VERKEHRSZAEHLUNG = JSON.parse(
    readFileSync(path.join(import.meta.dirname, '../../mock-catalog/traffic-counting/verkehrszaehlung.datastructure.json'), 'utf8'),
) as Record<string, unknown>

const options: ExportOptions = {
    publisher: 'stadt',
    slug: 'demo',
    version: '1.0.0',
    displayName: 'Demo',
    description: 'Ein Use Case zum Ausprobieren',
    maintainer: 'Stadt',
    license: 'EUPL-1.2',
    keywords: ['demo'],
    domain: 'environment',
    provenance: { datasetId: 'ds', datasetName: 'Demo', exportedAt: '2026-10-10' },
}

const ZAEHLSTELLEN_FEED = {
    name: 'Zählstellen-Feed',
    connectorType: 'MQTT',
    configuration: { urls: ['tcp://civitas-mosquitto:1883'], topics: ['openurbanapps/verkehrszaehlung/+'] },
}

function snapshotWith(
    model: Record<string, unknown>,
    source: { name: string; connectorType: string; configuration: Record<string, unknown> },
): InstanceSnapshot {
    return {
        dataset: { id: 'ds', name: 'Demo' },
        structures: [
            {
                versionId: 'v1',
                dataStructureId: 's1',
                name: typeof model.title === 'string' ? model.title : 'Messung',
                modelUrn: 'urn:core:instance:stadt:datastructure:default:messung:aaaaaaaaaa:1.0.0',
                model,
            },
        ],
        sources: [
            {
                id: 'src',
                ...source,
                configurationUrn: 'urn:core:instance:stadt:datasource:default:quelle:bbbbbbbbbb:1.0.0',
                structureVersionId: 'v1',
            },
        ],
        mappings: [],
        sinks: [],
        pipelines: [],
        warnings: [],
    }
}

/** Assembles the exported package exactly as the catalogue loads it; throws whatever the catalogue would reject. */
function assemble(pkg: ExportedPackage) {
    const entry = assembleCatalogEntry(pkg.manifest, (file) => JSON.parse(pkg.files[`core-ir/${file}`]) as Record<string, unknown>)
    return 'bundle' in entry ? entry.bundle.simulations : []
}

function simulationOf(pkg: ExportedPackage): Record<string, unknown> {
    const file = pkg.manifest.members.simulations?.[0]?.file
    if (!file) throw new Error(`no simulation drafted: ${pkg.warnings.join('; ')}`)
    return JSON.parse(pkg.files[`core-ir/${file}`]) as Record<string, unknown>
}

type Stream = { name: string; label: string; fields: Record<string, DraftGenerator> }

describe('drafted MQTT simulation', () => {
    const pkg = transformSnapshot(snapshotWith(VERKEHRSZAEHLUNG, ZAEHLSTELLEN_FEED), options)
    const simulation = simulationOf(pkg)
    const streams = simulation.streams as Stream[]

    it('targets the source, its message class and the subscription', () => {
        expect(simulation.sourceRef).toBe('Zählstellen-Feed')
        expect(simulation.messageClass).toBe('#/$defs/Messung')
        expect(simulation.topicBase).toBe('openurbanapps/verkehrszaehlung')
        expect(pkg.manifest.members.simulations).toEqual([{ file: 'zaehlstellen-feed.simulation.json' }])
    })

    it('runs several stations, each with its own identity', () => {
        expect(streams.map((s) => s.name)).toEqual(['zaehlstellen-feed-1', 'zaehlstellen-feed-2', 'zaehlstellen-feed-3'])
        expect(streams.map((s) => s.label)).toEqual(['Zählstellen-Feed 1', 'Zählstellen-Feed 2', 'Zählstellen-Feed 3'])
        expect(streams.map((s) => s.fields.counterId)).toEqual([
            { kind: 'constant', value: 'ZF-001' },
            { kind: 'constant', value: 'ZF-002' },
            { kind: 'constant', value: 'ZF-003' },
        ])
    })

    it('lets the property names choose the generators', () => {
        const fields = streams[0].fields
        expect(fields.timestamp).toEqual({ kind: 'now' })
        expect(fields.vehicleCount).toMatchObject({ kind: 'dailyProfile', min: 0, max: 40, integer: true })
        expect(fields.avgSpeedKmh).toMatchObject({ kind: 'randomWalk', min: 15, max: 50 })
        expect(fields.direction).toEqual({ kind: 'constant', value: 'direction 1' })
    })

    it("passes the catalogue's own checks", () => {
        expect(assemble(pkg)).toHaveLength(1)
    })

    it('lists the draft in the README', () => {
        expect(pkg.files['README.md']).toContain('`zaehlstellen-feed.simulation.json`')
    })
})

describe('nested measurement values', () => {
    const structure = {
        title: 'Bodenfeuchte-Messung',
        type: 'object',
        required: ['sensorId', 'timestamp', 'feuchte'],
        properties: {
            sensorId: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            feuchte: { $ref: '#/$defs/Wert' },
            bodentemperatur: { $ref: '#/$defs/Wert' },
        },
        $defs: {
            Wert: { type: 'object', required: ['value', 'unit'], properties: { value: { type: 'number' }, unit: { type: 'string' } } },
        },
    }
    const pkg = transformSnapshot(
        snapshotWith(structure, { name: 'Bodenfeuchte-Feed', connectorType: 'MQTT', configuration: { topics: ['stadt/bodenfeuchte'] } }),
        options,
    )

    it('walks into referenced objects with dotted paths, the parent naming the quantity', () => {
        const fields = (simulationOf(pkg).streams as Stream[])[0].fields
        expect(fields['feuchte.value']).toMatchObject({ kind: 'randomWalk', min: 10, max: 90 })
        expect(fields['feuchte.unit']).toEqual({ kind: 'constant', value: '%' })
        expect(fields['bodentemperatur.value']).toMatchObject({ kind: 'randomWalk', min: 5, max: 25 })
        expect(fields['bodentemperatur.unit']).toEqual({ kind: 'constant', value: 'Cel' })
    })

    it("publishes on an exact subscription as it is, and passes the catalogue's checks", () => {
        expect(simulationOf(pkg).topicBase).toBe('stadt/bodenfeuchte')
        expect(assemble(pkg)).toHaveLength(1)
    })
})

describe('drafted SQL simulation', () => {
    const kataster = {
        title: 'Baumkataster-Zeile',
        type: 'object',
        required: ['baum_id', 'lon', 'lat'],
        properties: {
            baum_id: { type: 'string' },
            gattung: { type: 'string', examples: ['Tilia', 'Acer'] },
            pflanzjahr: { type: 'integer', minimum: 2015, maximum: 2025 },
            lon: { type: 'number' },
            lat: { type: 'number' },
        },
    }
    const pkg = transformSnapshot(
        snapshotWith(kataster, { name: 'Baumkataster-DB', connectorType: 'SQL', configuration: { driver: 'postgres', table: 'kataster.baeume' } }),
        options,
    )
    const simulation = simulationOf(pkg)
    const fields = simulation.fields as Record<string, DraftGenerator>

    it('describes the table and mints a unique key', () => {
        expect(simulation.transport).toBe('sql')
        expect(simulation.table).toEqual({
            columns: { baum_id: 'text', gattung: 'text', pflanzjahr: 'integer', lon: 'double', lat: 'double' },
            primaryKey: 'baum_id',
        })
        expect(fields.baum_id).toEqual({ kind: 'sequence', prefix: 'BD-', padTo: 3 })
    })

    it('uses examples and bounds, and scatters coordinates', () => {
        expect(fields.gattung).toEqual({ kind: 'enum', values: ['Tilia', 'Acer'] })
        expect(fields.pflanzjahr).toMatchObject({ kind: 'randomWalk', min: 2015, max: 2025, integer: true })
        expect(fields.lat).toMatchObject({ kind: 'jitter', center: 52.52 })
        expect(fields.lon).toMatchObject({ kind: 'jitter', center: 13.405 })
    })

    it('writes master data once, to a fixed size', () => {
        expect(simulation).toMatchObject({ cadence: 'fillToLimit', maxRows: 200 })
    })

    it("passes the catalogue's own checks", () => {
        expect(assemble(pkg)).toHaveLength(1)
    })

    it('keeps a measurement table growing, its time as timestamptz', () => {
        const pegel = {
            title: 'Pegelmessung',
            type: 'object',
            required: ['messung_id', 'zeitpunkt'],
            properties: {
                messung_id: { type: 'string' },
                zeitpunkt: { type: 'string', format: 'date-time' },
                pegel_cm: { type: 'number' },
            },
        }
        const measurements = transformSnapshot(
            snapshotWith(pegel, { name: 'Pegel-DB', connectorType: 'SQL', configuration: { table: 'pegel.messungen' } }),
            options,
        )
        const drafted = simulationOf(measurements)
        expect(drafted).toMatchObject({ cadence: 'interval', seedRows: 50, maxRows: 500, table: { primaryKey: 'messung_id' } })
        expect((drafted.table as { columns: Record<string, string> }).columns.zeitpunkt).toBe('timestamptz')
        expect((drafted.fields as Record<string, DraftGenerator>).pegel_cm).toMatchObject({ kind: 'randomWalk', min: 80, max: 220 })
        expect(assemble(measurements)).toHaveLength(1)
    })
})

describe('bounds', () => {
    it('keeps declared bounds on every stream', () => {
        const draft = draftSimulation({
            sourceTitle: 'Parkhaus-Feed',
            source: { connectionType: 'mqtt', topics: ['parken/+'] },
            structure: { type: 'object', properties: { freiePlaetze: { type: 'integer', minimum: 0, maximum: 5 } } },
        })
        if (!('document' in draft)) throw new Error(draft.note)
        for (const stream of draft.document.streams as Stream[]) {
            expect(stream.fields.freiePlaetze).toMatchObject({ kind: 'dailyProfile', min: 0, max: 5 })
        }
    })
})

describe('sources the simulator cannot feed', () => {
    const plain = { type: 'object', properties: { wert: { type: 'number' } } }

    it.each([
        ['an HTTP source', { connectionType: 'http', url: 'https://example.org' }, plain, 'nur MQTT- und SQL-Quellen'],
        ['an MQTT source without a topic', { connectionType: 'mqtt' }, plain, 'kein MQTT-Topic'],
        ['a wildcard inside the topic', { connectionType: 'mqtt', topics: ['stadt/+/luft'] }, plain, 'kein Topic zum Senden'],
        [
            'a required field from a foreign structure',
            { connectionType: 'mqtt', topics: ['a/b'] },
            { type: 'object', required: ['ort'], properties: { ort: { $ref: 'urn:core:standard:x:datastructure:d:ort:0000000000' } } },
            'fremde Struktur',
        ],
        ['a table without a key', { connectionType: 'sql', table: 't' }, plain, 'Schlüsselspalte'],
        [
            'a table row with a nested object',
            { connectionType: 'sql', table: 't' },
            { type: 'object', required: ['id', 'ort'], properties: { id: { type: 'string' }, ort: { type: 'object', properties: { lat: { type: 'number' } } } } },
            'flach',
        ],
    ])('notes %s instead of drafting', (_, source, structure, reason) => {
        const draft = draftSimulation({ sourceTitle: 'Quelle', source, structure })
        expect('note' in draft ? draft.note : '').toContain(reason)
    })
})

describe('transformSnapshot and demo data', () => {
    it('drafts nothing when asked not to', () => {
        const pkg = transformSnapshot(snapshotWith(VERKEHRSZAEHLUNG, ZAEHLSTELLEN_FEED), { ...options, simulations: false })
        expect(pkg.manifest.members.simulations).toEqual([])
        expect(Object.keys(pkg.files).some((file) => file.endsWith('.simulation.json'))).toBe(false)
    })

    it('reports a source it cannot draft for as a hint, and still exports', () => {
        const pkg = transformSnapshot(
            snapshotWith(VERKEHRSZAEHLUNG, { name: 'Zählstellen-API', connectorType: 'HTTP', configuration: { url: 'https://example.org/api' } }),
            options,
        )
        expect(pkg.manifest.members.simulations).toEqual([])
        expect(pkg.warnings.some((warning) => warning.includes('Zählstellen-API'))).toBe(true)
    })
})
