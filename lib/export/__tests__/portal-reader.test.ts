import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isSafeDatasetId, PortalReadError, readUseCase } from '@/lib/export/portal-reader'
import { transformSnapshot, type ExportOptions } from '@/lib/export/transform'
import { logicalUrn } from '@/lib/export/urn'

/**
 * A dataset id is interpolated into the portal's REST paths, so the rule is
 * asserted directly rather than through `readUseCase`: going via the fetch made
 * the "accepted" cases depend on API_BASE_URL being unset under vitest, which is
 * a test that passes for the wrong reason.
 */
describe('isSafeDatasetId', () => {
    it('refuses the dot segments a URL parser folds away', () => {
        // `/v1/datasets/../pipelines` resolves to `/v1/pipelines`, which is why a
        // leading dot cannot be allowed — the earlier rule admitted exactly this.
        expect(new URL('http://h/v1/datasets/../pipelines').pathname).toBe('/v1/pipelines')
        for (const id of ['.', '..', '....', '../admin', './x']) {
            expect(isSafeDatasetId(id), id).toBe(false)
        }
    })

    it('refuses anything that could leave the segment', () => {
        for (const id of ['a/b', 'a\\b', 'a?b', 'a#b', 'a b', '', 'ä', '-lead']) {
            expect(isSafeDatasetId(id), JSON.stringify(id)).toBe(false)
        }
    })

    it('allows the shapes a portal actually issues', () => {
        // Dots inside the id are harmless: it is one segment and cannot hold a slash.
        for (const id of ['a..b', 'urn:core:dataset:x', '3f2b9c1a-0e4d-4a11-9d2e-7b6c5a4f3e21', 'v1.2']) {
            expect(isSafeDatasetId(id), id).toBe(true)
        }
    })

    it('stops at 200 characters', () => {
        expect(isSafeDatasetId('a'.repeat(200))).toBe(true)
        expect(isSafeDatasetId('a'.repeat(201))).toBe(false)
    })
})

/**
 * The Jungbaum use case as an instance holds it after install: two sources and
 * two PostGIS sinks whose outputs embed a version summary, two FROST sinks
 * whose outputs carry only `element`, and four mappings. Four of the six
 * structures are known from summaries; the two FROST targets must be found by
 * URN, through routes the platform actually serves.
 */
const BASE = 'http://portal.test:8080'
const DATASET = 'ds-jungbaum'
const urnOf = (type: string, name: string, version?: string) =>
    `urn:core:instance:musterbach:${type}:default:${name}:a1b2c3d4e5${version ? `:${version}` : ''}`

interface FakeStructure {
    id: string
    name: string
    key: string
    versions: string[]
}

// Newest first, as the platform lists them; the unrelated rows bracket the use case's own.
const STRUCTURES: FakeStructure[] = [
    { id: 's-fremd-neu', name: 'Parkplatz', key: 'parkplatz', versions: ['v-parkplatz'] },
    { id: 's-beobachtung', name: 'Bodenfeuchte-Beobachtung', key: 'bodenfeuchtebeobachtung', versions: ['v-beobachtung'] },
    { id: 's-wert', name: 'Bodenfeuchte-Wert', key: 'bodenfeuchtewert', versions: ['v-wert'] },
    { id: 's-messung', name: 'Bodenfeuchte-Messung', key: 'bodenfeuchtemessung', versions: ['v-messung'] },
    { id: 's-sensorbaum', name: 'Sensor-Jungbaum', key: 'sensorjungbaum', versions: ['v-sensorbaum-1', 'v-sensorbaum-2'] },
    { id: 's-jungbaum', name: 'Jungbaum', key: 'jungbaum', versions: ['v-jungbaum'] },
    { id: 's-zeile', name: 'Jungbaum-Zeile', key: 'jungbaumzeile', versions: ['v-zeile'] },
    { id: 's-fremd-alt', name: 'Laterne', key: 'laterne', versions: ['v-laterne'] },
]
const structure = (key: string, version = '1.0.0') => urnOf('datastructure', key, version)
const USE_CASE_KEYS = ['jungbaumzeile', 'jungbaum', 'sensorjungbaum', 'bodenfeuchtemessung', 'bodenfeuchtewert', 'bodenfeuchtebeobachtung']

const summary = (versionId: string, dataStructureId: string) => ({ id: versionId, dataStructureId, version: '1.0.0' })

const SINKS = [
    {
        id: 'sink-jungbaeume',
        name: 'Jungbäume-Tabelle',
        dataSinkType: 'POSTGIS',
        configurationUrn: urnOf('datasink', 'jungbaeumetabelle', '1.0.0'),
        configuration: { tableName: 'jungbaeume', element: structure('jungbaum'), dataStructureVersion: summary('v-jungbaum', 's-jungbaum') },
    },
    {
        id: 'sink-feuchte',
        name: 'Bodenfeuchte-Tabelle',
        dataSinkType: 'POSTGIS',
        configurationUrn: urnOf('datasink', 'bodenfeuchtetabelle', '1.0.0'),
        configuration: { tableName: 'bodenfeuchte', element: structure('bodenfeuchtewert'), dataStructureVersion: summary('v-wert', 's-wert') },
    },
    {
        id: 'sink-frost-baeume',
        name: 'Sensordaten-Speicher Bäume',
        dataSinkType: 'FROST',
        configurationUrn: urnOf('datasink', 'frostjungbaeume', '1.0.0'),
        // Pins the second version, so the older one must not win.
        configuration: { element: structure('sensorjungbaum', '2.0.0'), port: 'ThingTree' },
    },
    {
        id: 'sink-frost-messwerte',
        name: 'Sensordaten-Speicher Messwerte',
        dataSinkType: 'FROST',
        configurationUrn: urnOf('datasink', 'frostbodenfeuchte', '1.0.0'),
        configuration: { element: structure('bodenfeuchtebeobachtung'), port: 'Observations' },
    },
]

const MAPPINGS = [
    { key: 'katasterzujungbaum', title: 'Kataster → Jungbaum', source: structure('jungbaumzeile'), target: structure('jungbaum') },
    { key: 'katasterzusensorbaum', title: 'Kataster → Sensor-Jungbaum', source: structure('jungbaumzeile'), target: structure('sensorjungbaum', '2.0.0') },
    { key: 'messungzufeuchtewert', title: 'Messung → Feuchtewert', source: structure('bodenfeuchtemessung'), target: structure('bodenfeuchtewert') },
    { key: 'messungzufrostmesswert', title: 'Messung → Messwert am Baum', source: structure('bodenfeuchtemessung'), target: structure('bodenfeuchtebeobachtung') },
]

const PIPELINES = [
    { id: 'p-kataster-import', source: 'src-kataster', sourceKey: 'jungbaumkatasterdb', mapping: 'katasterzujungbaum', sink: 'sink-jungbaeume', sinkKey: 'jungbaeumetabelle' },
    { id: 'p-kataster-sensorik', source: 'src-kataster', sourceKey: 'jungbaumkatasterdb', mapping: 'katasterzusensorbaum', sink: 'sink-frost-baeume', sinkKey: 'frostjungbaeume' },
    { id: 'p-feuchte-import', source: 'src-feed', sourceKey: 'bodenfeuchtefeed', mapping: 'messungzufeuchtewert', sink: 'sink-feuchte', sinkKey: 'bodenfeuchtetabelle' },
    { id: 'p-feuchte-sensorik', source: 'src-feed', sourceKey: 'bodenfeuchtefeed', mapping: 'messungzufrostmesswert', sink: 'sink-frost-messwerte', sinkKey: 'frostbodenfeuchte' },
]

type Route = unknown | (() => Response)

function instanceRoutes(structures: FakeStructure[] = STRUCTURES): Record<string, Route> {
    const routes: Record<string, Route> = {
        [`/v1/datasets/${DATASET}`]: { id: DATASET, name: 'Jungbaum-Bewässerung' },
        [`/v1/datasets/${DATASET}/pipelines?size=100`]: { content: PIPELINES.map(({ id }) => ({ id, name: id })), last: true },
        [`/v1/datasets/${DATASET}/datasinks?size=100`]: { content: SINKS, last: true },
        '/v1/datasources/src-kataster': {
            id: 'src-kataster',
            name: 'Jungbaumkataster-DB',
            connectorType: 'SQL',
            configuration: { dsn: 'postgres://db:5432/fachverfahren', table: 'kataster.jungbaeume', password: '********' },
            configurationUrn: urnOf('datasource', 'jungbaumkatasterdb', '1.0.0'),
            dataStructureVersion: summary('v-zeile', 's-zeile'),
        },
        '/v1/datasources/src-feed': {
            id: 'src-feed',
            name: 'Bodenfeuchte-Feed',
            connectorType: 'MQTT',
            configuration: { urls: ['mqtt://broker:1883'], topics: ['bodenfeuchte/+'] },
            configurationUrn: urnOf('datasource', 'bodenfeuchtefeed', '1.0.0'),
            dataStructureVersion: summary('v-messung', 's-messung'),
        },
        '/v1/datastructures?size=200&page=0': {
            content: structures.map(({ id, name, versions }) => ({
                id,
                name,
                dataStructureVersions: versions.map((versionId, index) => ({
                    id: versionId,
                    dataStructureId: id,
                    version: `${index + 1}.0.0`,
                    dataStructureVersionStatus: 'RELEASED',
                })),
            })),
            last: true,
            totalPages: 1,
        },
    }
    for (const pipeline of PIPELINES) {
        routes[`/v1/datasets/${DATASET}/pipelines/${pipeline.id}`] = {
            id: pipeline.id,
            name: pipeline.id,
            model: {
                nodes: [
                    { id: 'n-source', kind: 'source', sourceRef: urnOf('datasource', pipeline.sourceKey, '1.0.0') },
                    { id: 'n-mapping', kind: 'mapping', mappingRef: urnOf('mapping', pipeline.mapping, '1.0.0') },
                    { id: 'n-sink', kind: 'sink', sinkRef: urnOf('datasink', pipeline.sinkKey, '1.0.0') },
                ],
                edges: [],
            },
            dataSourceIds: [pipeline.source],
            dataSinkIds: [pipeline.sink],
        }
    }
    for (const mapping of MAPPINGS) {
        const urn = urnOf('mapping', mapping.key, '1.0.0')
        routes[`/v1/datasets/${DATASET}/mappings?urn=${encodeURIComponent(urn)}`] = {
            title: mapping.title,
            source: mapping.source,
            target: mapping.target,
            fields: [],
        }
    }
    for (const { id, name, key, versions } of structures) {
        for (const [index, versionId] of versions.entries()) {
            const modelUrn = structure(key, `${index + 1}.0.0`)
            routes[`/v1/datastructures/${id}/versions/${versionId}`] = {
                id: versionId,
                modelUrn,
                model: { $id: modelUrn, title: name, type: 'object' },
                dataStructure: { id, name },
            }
        }
    }
    return routes
}

const problem = (status: number, detail: string) => () =>
    new Response(JSON.stringify({ detail }), { status, headers: { 'Content-Type': 'application/problem+json' } })

/** Serves the routes and records every URL; the version list answers 405, as the platform does. */
function fakePortal(routes: Record<string, Route>): string[] {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        calls.push(url)
        const path = url.slice(BASE.length)
        if (/\/versions(\?|$)/.test(path)) return problem(405, "Request method 'GET' is not supported.")()
        const route = routes[path]
        if (route === undefined) return new Response('', { status: 404 })
        if (typeof route === 'function') return (route as () => Response)()
        return new Response(JSON.stringify(route), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    return calls
}

const versionReads = (calls: string[]) => calls.filter((url) => /\/v1\/datastructures\/[^/]+\/versions\/[^/?]+$/.test(url))

const options: ExportOptions = {
    publisher: 'openurbanapps',
    slug: 'jungbaum-bewaesserung',
    version: '1.0.0',
    displayName: 'Jungbaum-Bewässerung',
    description: 'Jungbäume und ihre Bodenfeuchte.',
    maintainer: 'Open Urban Apps',
    license: 'EUPL-1.2',
    keywords: ['baum'],
    domain: 'environment',
    provenance: { datasetId: DATASET, datasetName: 'Jungbaum-Bewässerung', exportedAt: '2026-10-11' },
}

describe('readUseCase', () => {
    beforeEach(() => {
        vi.stubEnv('API_BASE_URL', 'http://portal.test')
        vi.stubEnv('API_PORT', '8080')
    })
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
    })

    it('reads all six structures and gives each FROST sink the version its element pins', async () => {
        fakePortal(instanceRoutes())
        const snapshot = await readUseCase('token', DATASET)
        expect(snapshot.warnings).toEqual([])
        expect(snapshot.structures.map((s) => logicalUrn(s.modelUrn)).sort()).toEqual(
            USE_CASE_KEYS.map((key) => logicalUrn(structure(key))).sort(),
        )
        expect(Object.fromEntries(snapshot.sinks.map((s) => [s.id, s.structureVersionId]))).toEqual({
            'sink-jungbaeume': 'v-jungbaum',
            'sink-feuchte': 'v-wert',
            'sink-frost-baeume': 'v-sensorbaum-2',
            'sink-frost-messwerte': 'v-beobachtung',
        })
        expect(snapshot.mappings).toHaveLength(4)
    })

    it('never asks for the version list the platform refuses, and reads each version once', async () => {
        const calls = fakePortal(instanceRoutes())
        await readUseCase('token', DATASET)
        expect(calls.filter((url) => /\/versions(\?|$)/.test(url))).toEqual([])
        const reads = versionReads(calls)
        expect(reads.length).toBe(new Set(reads).size)
        // The search stops once both FROST targets are found, so the oldest row is never opened.
        expect(reads.some((url) => url.includes('/s-fremd-alt/'))).toBe(false)
    })

    it('hands transform a snapshot whose FROST sinks resolve inside the package', async () => {
        fakePortal(instanceRoutes())
        const pkg = transformSnapshot(await readUseCase('token', DATASET), options)
        expect(pkg.warnings.filter((w) => w.includes('nicht Teil des Pakets'))).toEqual([])
        const beobachtung = pkg.identities.find((i) => i.from === logicalUrn(structure('bodenfeuchtebeobachtung')))
        const sink = JSON.parse(pkg.files['core-ir/sensordaten-speicher-messwerte.datasink.json']) as Record<string, unknown>
        expect(sink.element).toBe(beobachtung?.to)
    })

    it('turns a 405 on one version read during the search into a warning', async () => {
        const routes = instanceRoutes()
        routes['/v1/datastructures/s-beobachtung/versions/v-beobachtung'] = problem(405, "Request method 'GET' is not supported.")
        fakePortal(routes)
        const snapshot = await readUseCase('token', DATASET)
        expect(snapshot.structures).toHaveLength(5)
        expect(snapshot.sinks.find((s) => s.id === 'sink-frost-messwerte')?.structureVersionId).toBeUndefined()
        const missing = `Struktur ${structure('bodenfeuchtebeobachtung')} wurde nicht gefunden - eine Strukturversion war nicht lesbar: v-beobachtung (Request method 'GET' is not supported.)`
        expect(snapshot.warnings).toContain(`Senke Sensordaten-Speicher Messwerte: ${missing}`)
        expect(snapshot.warnings).toContain(`Mapping ${urnOf('mapping', 'messungzufrostmesswert', '1.0.0')}: ${missing}`)
    })

    it('warns about an element URN no structure of the instance pins', async () => {
        const routes = instanceRoutes()
        const unknown = structure('gibtesnicht')
        routes[`/v1/datasets/${DATASET}/datasinks?size=100`] = {
            content: SINKS.map((sink) =>
                sink.id === 'sink-frost-baeume' ? { ...sink, configuration: { element: unknown, port: 'ThingTree' } } : sink,
            ),
            last: true,
        }
        const calls = fakePortal(routes)
        const snapshot = await readUseCase('token', DATASET)
        expect(snapshot.warnings).toEqual([`Senke Sensordaten-Speicher Bäume: Struktur ${unknown} ist auf dieser Instanz nicht auffindbar`])
        expect(snapshot.sinks.find((s) => s.id === 'sink-frost-baeume')?.structureVersionId).toBeUndefined()
        // The mapping still names the sensor tree, so it is found all the same.
        expect(snapshot.structures).toHaveLength(6)
        expect(versionReads(calls).some((url) => url.includes('/s-fremd-alt/'))).toBe(true)
    })

    it('reports a structure list it cannot read instead of failing the inventory', async () => {
        const routes = instanceRoutes()
        routes['/v1/datastructures?size=200&page=0'] = problem(500, 'Interner Fehler')
        fakePortal(routes)
        const snapshot = await readUseCase('token', DATASET)
        expect(snapshot.structures).toHaveLength(4)
        expect(snapshot.warnings).toContain(
            `Senke Sensordaten-Speicher Bäume: Struktur ${structure('sensorjungbaum', '2.0.0')} konnte nicht gesucht werden: Interner Fehler`,
        )
    })

    it('stops after the read bound and says so', async () => {
        const crowd = Array.from({ length: 301 }, (_, index) => ({ id: `s-${index}`, name: `Fremd ${index}`, key: `fremd${index}`, versions: [`v-${index}`] }))
        const routes = instanceRoutes([...crowd, ...STRUCTURES])
        const calls = fakePortal(routes)
        const snapshot = await readUseCase('token', DATASET)
        // The four summary reads, then exactly the bound.
        expect(versionReads(calls)).toHaveLength(4 + 300)
        expect(snapshot.warnings).toContain(
            `Senke Sensordaten-Speicher Bäume: Struktur ${structure('sensorjungbaum', '2.0.0')} wurde in den ersten 300 Strukturversionen nicht gefunden - Suche abgebrochen`,
        )
    })

    it('still fails when the pipelines cannot be read', async () => {
        const routes = instanceRoutes()
        routes[`/v1/datasets/${DATASET}/pipelines?size=100`] = problem(500, 'Interner Fehler')
        fakePortal(routes)
        await expect(readUseCase('token', DATASET)).rejects.toBeInstanceOf(PortalReadError)
    })
})
