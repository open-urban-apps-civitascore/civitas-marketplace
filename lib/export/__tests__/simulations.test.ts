import { describe, expect, it } from 'vitest'

import { checkPackage } from '@/lib/export/package-check'
import type { InstanceSnapshot } from '@/lib/export/portal-reader'
import { demoSources, draftRegistrations, generatedId, simulationMembers, topicMatches } from '@/lib/export/simulations'
import { transformSnapshot, type ExportOptions } from '@/lib/export/transform'
import type { SimulationDetail, SimulationInput } from '@/lib/simulator/client'

/**
 * A Jungbaum-shaped dataset: an MQTT feed of soil moisture whose structure keeps
 * its message in $defs, and a SQL cadastre. The simulator holds streams of this
 * installation, one stream of ANOTHER installation on the same topic, a stream
 * made by hand without an origin, and the cadastre's table filler.
 */
const MESSUNG = 'urn:core:platform:civitas:datastructure:environment:bodenfeuchtemessung:abc1234567:1.0.0'
const ZEILE = 'urn:core:platform:civitas:datastructure:environment:jungbaumzeile:def1234567:1.0.0'

function snapshot(): InstanceSnapshot {
    return {
        dataset: { id: 'ds-copy', name: 'Jungbaum geteilt' },
        structures: [
            {
                versionId: 'v-messung', dataStructureId: 's-messung', name: 'Bodenfeuchte-Messung', modelUrn: MESSUNG,
                model: {
                    $id: MESSUNG, title: 'Bodenfeuchte-Messung', $ref: '#/$defs/BodenfeuchteMessung',
                    $defs: {
                        BodenfeuchteMessung: {
                            type: 'object', required: ['sensorId', 'timestamp', 'feuchte'],
                            properties: {
                                sensorId: { type: 'string' }, timestamp: { type: 'string' },
                                feuchte: { type: 'object', required: ['value'], properties: { value: { type: 'number' }, unit: { type: 'string' } } },
                            },
                        },
                    },
                },
            },
            {
                versionId: 'v-zeile', dataStructureId: 's-zeile', name: 'Jungbaum-Zeile', modelUrn: ZEILE,
                model: { $id: ZEILE, title: 'Jungbaum-Zeile', type: 'object', required: ['baum_id'], properties: { baum_id: { type: 'string' }, gattung: { type: 'string' } } },
            },
        ],
        sources: [
            {
                id: 'src-feed', name: 'Bodenfeuchte-Feed', connectorType: 'MQTT', structureVersionId: 'v-messung',
                configurationUrn: 'urn:core:platform:civitas:datasource:environment:bodenfeuchtefeed:ghi1234567:1.0.0',
                configuration: { urls: ['tcp://demo-data-generator-simulator-broker.core.svc.cluster.local:1883'], topics: ['openurbanapps/bodenfeuchte/+'] },
            },
            {
                id: 'src-db', name: 'Jungbaumkataster-DB', connectorType: 'SQL', structureVersionId: 'v-zeile',
                configuration: { driver: 'postgres', dsn: 'postgres://demo-data-generator-simulator-db.core.svc.cluster.local:5432/demo_source', user: 'demo', table: 'kataster.jungbaeume', columns: ['baum_id', 'gattung'] },
            },
        ],
        sinks: [],
        pipelines: [],
        mappings: [],
        warnings: [],
    }
}

const messung = { sensorId: { kind: 'constant', value: 'BF-001' }, timestamp: { kind: 'now' }, 'feuchte.value': { kind: 'dailyProfile', min: 6, max: 16, peakHours: [4] }, 'feuchte.unit': { kind: 'constant', value: '%' } }

function detail(id: string, input: Partial<SimulationInput> & Pick<SimulationInput, 'transport' | 'scenario'>): SimulationDetail {
    return {
        id, name: input.name, origin: input.origin, enabled: true, topic: input.transport.kind === 'mqtt' ? input.transport.topic : '', url: '',
        intervalSeconds: input.scenario.intervalSeconds ?? 10, createdAt: '2026-10-11T00:00:00Z', publishedCount: 0, lastPublishedAt: null,
        lastPayload: null, lastError: null, input: { enabled: true, ...input },
    } as SimulationDetail
}

const details: SimulationDetail[] = [
    // This installation's stream, tied to the source by the origin the install recorded.
    detail('inst-copy--bf-001', {
        name: 'Jungbaum geteilt · Jungbaum KB-001 (trocken)',
        origin: { installationId: 'inst-copy', dataSource: { name: 'Bodenfeuchte-Feed', id: 'src-feed' }, stream: 'bf-001' },
        transport: { kind: 'mqtt', url: 'tcp://broker:1883', topic: 'openurbanapps/bodenfeuchte/bf-001' },
        scenario: { intervalSeconds: 10, fields: messung as never },
    }),
    // The original installation's stream on the same topic: its origin names another source.
    detail('inst-original--bf-001', {
        name: 'Jungbaumbewässerung · Jungbaum KB-001 (trocken)',
        origin: { installationId: 'inst-original', dataSource: { name: 'Bodenfeuchte-Feed', id: 'src-original' }, stream: 'bf-001' },
        transport: { kind: 'mqtt', url: 'tcp://broker:1883', topic: 'openurbanapps/bodenfeuchte/bf-001' },
        scenario: { intervalSeconds: 10, fields: messung as never },
    }),
    // Made by hand in the simulator: no origin, found by the topic.
    detail('handmade-zusatz', {
        name: 'Zusatzsensor am Hafenweg',
        transport: { kind: 'mqtt', url: 'tcp://broker:1883', topic: 'openurbanapps/bodenfeuchte/zusatz' },
        scenario: { intervalSeconds: 10, fields: messung as never },
    }),
    // A stream for some other topic altogether.
    detail('unrelated', {
        name: 'Luftqualität',
        transport: { kind: 'mqtt', url: 'tcp://broker:1883', topic: 'openurbanapps/luft/station-1' },
        scenario: { intervalSeconds: 60, fields: { pm25: { kind: 'constant', value: 3 } } as never },
    }),
    // The cadastre's filler, found by its table.
    detail('kataster', {
        name: 'Baumkataster',
        transport: { kind: 'sql', table: 'kataster.jungbaeume', readDsn: 'postgres://db:5432/demo_source' },
        scenario: { table: { columns: { baum_id: 'text', gattung: 'text' }, primaryKey: 'baum_id' }, fields: { baum_id: { kind: 'constant', value: 'KB-001' }, gattung: { kind: 'enum', values: ['Tilia'] } } as never, cadence: 'fillToLimit', maxRows: 25 },
    }),
]

describe('topicMatches', () => {
    it('follows MQTT wildcards', () => {
        expect(topicMatches('a/+', 'a/b')).toBe(true)
        expect(topicMatches('a/+', 'a/b/c')).toBe(false)
        expect(topicMatches('a/#', 'a/b/c')).toBe(true)
        expect(topicMatches('a/b', 'a/b')).toBe(true)
        expect(topicMatches('a/b', 'a/c')).toBe(false)
    })
})

describe('demoSources', () => {
    it('finds the streams that feed each source, and leaves another installation its own', () => {
        const [feed, db] = demoSources(snapshot(), details)
        expect(feed.streams.map((stream) => [stream.id, stream.matchedBy, stream.label])).toEqual([
            ['inst-copy--bf-001', 'origin', 'Jungbaum KB-001 (trocken)'],
            ['handmade-zusatz', 'address', 'Zusatzsensor am Hafenweg'],
        ])
        expect(db.streams.map((stream) => stream.id)).toEqual(['kataster'])
        expect(feed.structureUrn).toBe('urn:core:platform:civitas:datastructure:environment:bodenfeuchtemessung:abc1234567')
    })
})

describe('simulationMembers', () => {
    const chosen = new Set(['inst-copy--bf-001', 'handmade-zusatz', 'kataster', 'inst-original--bf-001'])
    const { simulations, warnings } = simulationMembers(snapshot(), details, chosen)

    it('turns streams back into the package form the install reads', () => {
        // The original installation's stream was ticked but feeds another source: named, not taken.
        expect(warnings).toEqual(['Ein gewählter Datenstrom gehört nicht (mehr) zu diesem Datensatz und fehlt im Paket: inst-original--bf-001'])
        expect(simulations).toEqual([
            {
                sourceRef: 'Bodenfeuchte-Feed', messageClass: '#/$defs/BodenfeuchteMessung', topicBase: 'openurbanapps/bodenfeuchte', intervalSeconds: 10,
                streams: [
                    { name: 'bf-001', label: 'Jungbaum KB-001 (trocken)', fields: messung },
                    { name: 'zusatzsensor-am-hafenweg', label: 'Zusatzsensor am Hafenweg', fields: messung },
                ],
            },
            {
                transport: 'sql', sourceRef: 'Jungbaumkataster-DB', messageClass: '#', label: 'Baumkataster',
                table: { columns: { baum_id: 'text', gattung: 'text' }, primaryKey: 'baum_id' },
                fields: { baum_id: { kind: 'constant', value: 'KB-001' }, gattung: { kind: 'enum', values: ['Tilia'] } },
                cadence: 'fillToLimit', maxRows: 25,
            },
        ])
    })

    it('carries nothing of the instance: no broker, no database, no ids', () => {
        const text = JSON.stringify(simulations)
        for (const local of ['tcp://', 'postgres://', 'inst-copy', 'src-feed', 'inst-original']) expect(text).not.toContain(local)
    })

    it('ignores a chosen id that feeds no source of the dataset', () => {
        expect(simulationMembers(snapshot(), details, new Set(['unrelated'])).simulations).toEqual([])
    })

    it('makes a package the install accepts, with neutral addresses', () => {
        const options: ExportOptions = {
            publisher: 'openurbanapps', slug: 'jungbaum-geteilt', version: '1.0.0', displayName: 'Jungbaum geteilt', description: 'Test',
            maintainer: 'Test', license: 'EUPL-1.2', keywords: [], domain: 'environment', simulations,
            provenance: { datasetId: 'ds-copy', datasetName: 'Jungbaum geteilt', exportedAt: '2026-10-11' },
        }
        const pkg = transformSnapshot(snapshot(), options)
        expect(pkg.manifest.members.simulations?.map((member) => member.file)).toEqual(['bodenfeuchte-feed.simulation.json', 'jungbaumkataster-db.simulation.json'])
        expect(checkPackage(pkg.files)).toEqual([])
        const feed = JSON.parse(pkg.files['core-ir/bodenfeuchte-feed.datasource.json'])
        const db = JSON.parse(pkg.files['core-ir/jungbaumkataster-db.datasource.json'])
        expect(feed.urls).toEqual(['tcp://civitas-mosquitto:1883'])
        expect(db.dsn).toBe('postgres://localhost:5432/demo_source')
    })

    it('lets the package check refuse demo data the install would refuse', () => {
        const broken = simulations.map((simulation) => ({ ...simulation, topicBase: 'woanders' }))
        const pkg = transformSnapshot(snapshot(), {
            publisher: 'openurbanapps', slug: 'x', version: '1.0.0', displayName: 'x', description: 'x', maintainer: 'x', license: 'EUPL-1.2',
            keywords: [], domain: 'environment', simulations: [broken[0]], provenance: { datasetId: 'ds', datasetName: 'x', exportedAt: '2026-10-11' },
        })
        expect(checkPackage(pkg.files)).toEqual([
            expect.stringContaining("Die Installation würde die Demo-Daten ablehnen (abwählen hilft): urn:openurbanapps:usecase:x: simulation 'bodenfeuchte-feed.simulation.json': topicBase 'woanders' does not match"),
        ])
    })
})

describe('demoSources: a source without a Topic', () => {
    it('is flagged at once, because its streams could not travel in a package', () => {
        const withoutTopic = snapshot()
        withoutTopic.sources[0]!.configuration = { urls: ['tcp://broker:1883'], topics: [] }
        const [feed, db] = demoSources(withoutTopic, details)
        expect(feed.problem).toBe('no-topic')
        expect(db.problem).toBeUndefined()
        expect(demoSources(snapshot(), details)[0]!.problem).toBeUndefined()
    })

    it('counts an empty Topic as none, like the export does', () => {
        const emptyTopic = snapshot()
        emptyTopic.sources[0]!.configuration = { urls: ['tcp://broker:1883'], topics: [''] }
        expect(demoSources(emptyTopic, details)[0]!.problem).toBe('no-topic')
    })
})

describe('demo data drafted from the structure, where the simulator has none', () => {
    it('offers a draft per source without streams, chosen by its own id, and none beside streams', () => {
        const [feed, db] = demoSources(snapshot(), [])
        expect(feed.generated).toEqual({ id: generatedId('src-feed'), summary: '3 Datenströme mit je 4 Feldern, eine Nachricht alle 10 Sekunden' })
        expect(db.generated).toEqual({ id: generatedId('src-db'), summary: '200 Zeilen mit 2 Spalten, einmal angelegt' })
        expect(demoSources(snapshot(), details).some((source) => source.generated || source.notGenerated)).toBe(false)
    })

    it('says why where no draft fits, and offers none for a source without a Topic', () => {
        const keyless = snapshot()
        keyless.structures[1]!.model = { title: 'Zeile', type: 'object', properties: { gattung: { type: 'string' } } }
        keyless.sources[0]!.configuration = { urls: ['tcp://broker:1883'], topics: [] }
        const [feed, db] = demoSources(keyless, [])
        expect(db.generated).toBeUndefined()
        expect(db.notGenerated).toContain('jede Zeile eindeutig')
        expect([feed.problem, feed.generated, feed.notGenerated]).toEqual(['no-topic', undefined, undefined])
    })

    it('packages a ticked draft, leaves an unticked one, and misses no stream for it', () => {
        const ticked = simulationMembers(snapshot(), [], new Set([generatedId('src-feed')]))
        expect(ticked.warnings).toEqual([])
        expect(ticked.simulations).toMatchObject([{ sourceRef: 'Bodenfeuchte-Feed', topicBase: 'openurbanapps/bodenfeuchte', streams: [{}, {}, {}] }])
        expect(simulationMembers(snapshot(), [], new Set()).simulations).toEqual([])
    })

    it('makes a package the install accepts, with stream names unique across it', () => {
        const twin = snapshot()
        twin.sources.push({ ...twin.sources[0]!, id: 'src-twin', name: 'Bodenfeuchte Feed' })
        const chosen = new Set([generatedId('src-feed'), generatedId('src-twin'), generatedId('src-db')])
        const { simulations, warnings } = simulationMembers(twin, [], chosen)
        expect(warnings).toEqual([])
        const names = simulations.flatMap((simulation) => ('streams' in simulation ? simulation.streams.map((stream) => stream.name) : []))
        expect(names).toHaveLength(6)
        expect(new Set(names).size).toBe(6)
        const pkg = transformSnapshot(twin, {
            publisher: 'openurbanapps', slug: 'jungbaum-geteilt', version: '1.0.0', displayName: 'Jungbaum geteilt', description: 'Test',
            maintainer: 'Test', license: 'EUPL-1.2', keywords: [], domain: 'environment', simulations,
            provenance: { datasetId: 'ds-copy', datasetName: 'Jungbaum geteilt', exportedAt: '2026-11-01' },
        })
        expect(checkPackage(pkg.files)).toEqual([])
    })
})

describe('draftRegistrations: a draft put into the simulator to adjust it there', () => {
    const planned = draftRegistrations(snapshot(), 'src-feed', undefined)
    const registrations = 'registrations' in planned ? planned.registrations : []

    it('registers each station switched off, on its own topic, tied to the source', () => {
        expect(registrations.map((one) => one.id)).toEqual(['share--src-feed--bodenfeuchte-feed-1', 'share--src-feed--bodenfeuchte-feed-2', 'share--src-feed--bodenfeuchte-feed-3'])
        expect(registrations[0]!.input).toMatchObject({
            name: 'Jungbaum geteilt · Bodenfeuchte-Feed 1',
            enabled: false,
            transport: { kind: 'mqtt', url: 'tcp://demo-data-generator-simulator-broker.core.svc.cluster.local:1883', topic: 'openurbanapps/bodenfeuchte/bodenfeuchte-feed-1' },
            origin: { dataSet: { id: 'ds-copy' }, dataSource: { id: 'src-feed', name: 'Bodenfeuchte-Feed' }, stream: 'bodenfeuchte-feed-1' },
        })
        const override = draftRegistrations(snapshot(), 'src-feed', 'tcp://localhost:1883')
        expect('registrations' in override && override.registrations[0]!.input.transport).toMatchObject({ url: 'tcp://localhost:1883' })
    })

    it('comes back as the source’s streams, which then travel as the draft did', () => {
        const registered = registrations.map(({ id, input }) => detail(id, input))
        const [feed] = demoSources(snapshot(), registered)
        expect(feed.streams.map((stream) => [stream.label, stream.matchedBy])).toEqual([
            ['Bodenfeuchte-Feed 1', 'origin'],
            ['Bodenfeuchte-Feed 2', 'origin'],
            ['Bodenfeuchte-Feed 3', 'origin'],
        ])
        expect(feed.generated).toBeUndefined()
        const drafted = simulationMembers(snapshot(), [], new Set([generatedId('src-feed')])).simulations
        const readBack = simulationMembers(snapshot(), registered, new Set(registrations.map((one) => one.id))).simulations
        expect(readBack).toEqual(drafted)
    })

    it('fills a table once, and says why it registers nothing', () => {
        const table = draftRegistrations(snapshot(), 'src-db', undefined)
        expect('registrations' in table && table.registrations).toMatchObject([
            { id: 'share--src-db--jungbaumkataster-db', input: { enabled: false, transport: { kind: 'sql', table: 'kataster.jungbaeume' }, scenario: { cadence: 'fillToLimit', maxRows: 200 } } },
        ])
        expect(draftRegistrations(snapshot(), 'elsewhere', undefined)).toEqual({ note: 'die Datenquelle gehört nicht (mehr) zu diesem Datensatz' })
        const brokerless = snapshot()
        brokerless.sources[0]!.configuration = { topics: ['openurbanapps/bodenfeuchte/+'] }
        expect(draftRegistrations(brokerless, 'src-feed', undefined)).toEqual({ note: 'der Simulator kennt keinen Broker für diese Datenquelle' })
    })
})
