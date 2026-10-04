import { isSqlSimulation } from '@/lib/catalog/types'
import { describe, expect, it } from 'vitest'

import { assembleCatalogEntry } from '@/lib/catalog/assemble'
import type { UseCaseEntry } from '@/lib/catalog/types'
import {
    applyDeclaredDsnOverride,
    applyDeclaredUrlOverride,
    resolveDsnOverride,
} from '@/lib/install-payload'
import { mockPackages } from '@/lib/mock-catalog'
import type { InstallationReceipt } from '@/lib/install-payload'
import {
    planSimulations,
    readableStreamName,
    registerPlanned,
    simulationIdPrefix,
    streamsOfInstallation,
    type PlannedSimulation,
} from '@/lib/simulator/registration'
import type { SimulationStatus } from '@/lib/simulator/client'

const INSTALLATION_ID = 'a1b2c3d4-0000-4000-8000-000000000000'

function useCaseEntries(): UseCaseEntry[] {
    return mockPackages
        .filter((pkg) => pkg.manifest.type === 'usecase')
        .map(
            (pkg) =>
                assembleCatalogEntry(pkg.manifest, (file) => {
                    const content = pkg.files[file]
                    if (!content) throw new Error(`fixture ${pkg.manifest.id} misses '${file}'`)
                    return content
                }) as UseCaseEntry,
        )
}

describe('planSimulations', () => {
    it('plans one registration per stream, and one per SQL table', () => {
        // A table is one shape, not many: a SQL scenario is a single
        // registration however many rows it seeds.
        for (const entry of useCaseEntries()) {
            const planned = planSimulations(entry, INSTALLATION_ID)
            const expected = entry.bundle.simulations.reduce(
                (sum, simulation) => sum + (isSqlSimulation(simulation) ? 1 : simulation.streams.length),
                0,
            )
            expect(planned, entry.manifest.id).toHaveLength(expected)
        }
    })

    it('derives ids from the installation prefix and topics from the datasource subscription', () => {
        for (const entry of useCaseEntries()) {
            const planned = planSimulations(entry, INSTALLATION_ID)
            const subscriptions = entry.bundle.dataSources
                .map((source) => (Array.isArray(source.document.topics) ? source.document.topics[0] : undefined))
                .filter((topic): topic is string => typeof topic === 'string')
            for (const { id, input } of planned) {
                if (input.transport.kind !== 'mqtt') continue
                // The prefix is the uninstall's only handle on these registrations.
                expect(id.startsWith(simulationIdPrefix(INSTALLATION_ID))).toBe(true)
                expect(input.enabled).toBe(true)
                // The subscription decides: wildcard → own subtopic per stream,
                // exact → the exact topic. Either way every published message is
                // one the installed source actually receives.
                const matches = subscriptions.some((subscription) =>
                    subscription.endsWith('/+') || subscription.endsWith('/#')
                        ? mqttTransport(input.transport).topic.startsWith(subscription.slice(0, -1)) &&
                          !mqttTransport(input.transport).topic.slice(subscription.length - 1).includes('/')
                        : mqttTransport(input.transport).topic === subscription,
                )
                expect(matches, `${entry.manifest.id}: ${mqttTransport(input.transport).topic}`).toBe(true)
            }
        }
    })

    it('publishes to the exact topic when the datasource subscribes without a wildcard', () => {
        // The traffic package is the regression case: its source subscribes to
        // one exact topic, and the former topicBase/<stream> derivation published
        // one level below it — running streams, zero rows.
        const traffic = useCaseEntries().find((entry) => entry.manifest.id.includes('verkehr'))
        expect(traffic).toBeDefined()
        const subscription = traffic!.bundle.dataSources[0].document.topics as string[]
        for (const { input } of planSimulations(traffic!, INSTALLATION_ID)) {
            expect(mqttTransport(input.transport).topic).toBe(subscription[0])
        }
    })

    it('takes the broker from the datasource the scenario names', () => {
        for (const entry of useCaseEntries()) {
            for (const { input } of planSimulations(entry, INSTALLATION_ID)) {
                // A SQL scenario carries no broker: the generator writes to the
                // database it was configured with.
                if (input.transport.kind !== 'mqtt') continue
                const declaredUrls = entry.bundle.dataSources.flatMap((source) =>
                    Array.isArray(source.document.urls) ? (source.document.urls as string[]) : [],
                )
                expect(declaredUrls, entry.manifest.id).toContain(mqttTransport(input.transport).url)
            }
        }
    })

    it('lets a broker override win over the package value', () => {
        const [entry] = useCaseEntries()
        for (const { input } of planSimulations(entry, INSTALLATION_ID, 'tcp://localhost:1883')) {
            expect(mqttTransport(input.transport).url).toBe('tcp://localhost:1883')
        }
    })

    it('carries the scenario interval into every stream', () => {
        for (const entry of useCaseEntries()) {
            const intervals = new Set(
                entry.bundle.simulations
                    .map((simulation) => simulation.intervalSeconds)
                    .filter((interval): interval is number => interval !== undefined),
            )
            for (const { input } of planSimulations(entry, INSTALLATION_ID)) {
                if (input.scenario.intervalSeconds !== undefined) {
                    expect(intervals.has(input.scenario.intervalSeconds)).toBe(true)
                }
            }
        }
    })
})

describe('stream names and origin', () => {
    const entries = useCaseEntries()
    const traffic = () => entries.find((entry) => entry.manifest.id.includes('verkehr'))!
    const jungbaum = () => entries.find((entry) => entry.manifest.id.includes('jungbaum'))!

    /** The platform's record of an install: every member copied under a name of its own. */
    function receiptFor(entry: UseCaseEntry, dataSetName: string): InstallationReceipt {
        return {
            id: INSTALLATION_ID,
            packageVersion: entry.manifest.version,
            dataSetId: 'ds-0001',
            dataSetName,
            artifacts: [
                { artifactType: 'DATA_SET', name: dataSetName, urn: 'urn:core:standard:musterhausen:dataset:x:set:ds0001' },
                ...entry.bundle.dataSources.map((source, index) => ({
                    artifactType: 'DATA_SOURCE',
                    name: `${String(source.document.title)} (Instanz)`,
                    urn: `urn:core:standard:musterhausen:datasource:x:quelle${index}:inst`,
                    shellId: `src-${index}`,
                    origin: String(source.document.id),
                })),
                ...entry.bundle.dataStructures.map((structure, index) => ({
                    artifactType: 'DATA_STRUCTURE',
                    name: structure.name,
                    urn: `urn:core:standard:musterhausen:datastructure:x:struktur${index}:inst`,
                    shellId: `struct-${index}`,
                    origin: String(structure.model.$id),
                })),
            ],
        }
    }

    it('names a stream after its dataset, then its readable stream name', () => {
        const entry = traffic()
        const [first] = planSimulations(entry, INSTALLATION_ID, undefined, receiptFor(entry, 'Verkehrszählung Musterhausen'))
        expect(first.input.name).toBe('Verkehrszählung Musterhausen · Zaehlstelle Promenade')
    })

    it('ties every stream to the installed copies it feeds, found by the URN they carried in the package', () => {
        const entry = traffic()
        const planned = planSimulations(entry, INSTALLATION_ID, undefined, receiptFor(entry, 'Verkehrszählung Musterhausen'))
        for (const { input } of planned) {
            const origin = input.origin!
            expect(origin.installationId).toBe(INSTALLATION_ID)
            expect(origin.useCase).toEqual({
                id: entry.manifest.id,
                name: entry.manifest.displayName,
                version: entry.manifest.version,
            })
            expect(origin.dataSet).toEqual({
                name: 'Verkehrszählung Musterhausen',
                urn: 'urn:core:standard:musterhausen:dataset:x:set:ds0001',
                id: 'ds-0001',
            })
            // The installed copy's name and ids, not the package's: that is what the portal shows.
            expect(origin.dataSource).toMatchObject({ name: 'Zählstellen-Feed (Instanz)', id: expect.stringMatching(/^src-/) })
            expect(origin.dataStructure?.urn).toMatch(/:inst$/)
            // A simulator UI from before the origin finds the structure by its name in the prose.
            expect(input.description).toContain(origin.dataStructure!.name)
        }
        expect(planned.map((p) => p.input.origin?.stream)).toEqual(
            planned.map((p) => p.id.slice(simulationIdPrefix(INSTALLATION_ID).length)),
        )
    })

    it('prefers the label the package author wrote, for streams and for a table', () => {
        const entry = jungbaum()
        const names = planSimulations(
            entry,
            INSTALLATION_ID,
            undefined,
            receiptFor(entry, 'Jungbaumbewässerung Musterbach'),
        ).map((p) => p.input.name)
        expect(names).toContain('Jungbaumbewässerung Musterbach · Jungbaum KB-001 (trocken)')
        expect(names).toContain('Jungbaumbewässerung Musterbach · Baumkataster')
    })

    it('names from the package alone when the platform record could not be read', () => {
        const entry = traffic()
        const [first] = planSimulations(entry, INSTALLATION_ID)
        expect(first.input.name).toBe(`${entry.manifest.displayName} · Zaehlstelle Promenade`)
        expect(first.input.origin?.dataSet).toBeUndefined()
        // The bundle's title and no ids: the copy's ids are unknown without the record.
        expect(first.input.origin?.dataSource).toEqual({ name: 'Zählstellen-Feed' })
    })

    it("stays inside the simulator's limits, which would otherwise refuse the whole registration", () => {
        const entry = traffic()
        const receipt = receiptFor(entry, 'D'.repeat(250))
        receipt.artifacts = receipt.artifacts!.map((line) =>
            line.artifactType === 'DATA_SOURCE' ? { ...line, urn: `urn:${'x'.repeat(600)}` } : line,
        )
        for (const { input } of planSimulations(entry, INSTALLATION_ID, undefined, receipt)) {
            expect(input.name!.length).toBeLessThanOrEqual(200)
            expect(input.origin?.dataSet?.name.length).toBeLessThanOrEqual(200)
            // Left out rather than cut: half a URN would match nothing, or the wrong thing.
            expect(input.origin?.dataSource?.urn).toBeUndefined()
            expect(input.origin?.dataSource?.id).toBeDefined()
        }
    })

    it('keeps the id a key: the record changes names, never ids', () => {
        const entry = traffic()
        expect(
            planSimulations(entry, INSTALLATION_ID, undefined, receiptFor(entry, 'Anders benannt')).map((p) => p.id),
        ).toEqual(planSimulations(entry, INSTALLATION_ID).map((p) => p.id))
    })
})

describe('readableStreamName', () => {
    it('turns a slug into words, without guessing umlauts', () => {
        expect(readableStreamName('zaehlstelle-promenade')).toBe('Zaehlstelle Promenade')
        expect(readableStreamName('bf_001')).toBe('Bf 001')
    })
})

describe('streamsOfInstallation', () => {
    const status = (id: string): SimulationStatus => ({
        id,
        enabled: true,
        topic: 'openurbanapps/x',
        url: 'tcp://broker:1883',
        intervalSeconds: 10,
        createdAt: '2026-08-23T20:00:00Z',
        publishedCount: 0,
        lastPublishedAt: null,
        lastPayload: null,
        lastError: null,
    })

    it('claims exactly the prefix-matching streams, sorted, with the prefix stripped', () => {
        const rows = streamsOfInstallation(
            [status('inst-1--zaehler'), status('inst-2--fremd'), status('inst-1--ampel')],
            'inst-1',
        )
        expect(rows.map((row) => row.streamName)).toEqual(['ampel', 'zaehler'])
        expect(rows.map((row) => row.status.id)).toEqual(['inst-1--ampel', 'inst-1--zaehler'])
    })

    it('never claims another installation whose id merely starts with this one', () => {
        // 'inst-1' vs 'inst-10': a substring match would leak streams across
        // installations — the '--' in the prefix is what prevents it.
        const rows = streamsOfInstallation([status('inst-10--stream')], 'inst-1')
        expect(rows).toEqual([])
    })
})

describe('registerPlanned', () => {
    const planned = (installationId: string, streamName: string): PlannedSimulation => ({
        id: `${simulationIdPrefix(installationId)}${streamName}`,
        input: {
            transport: { kind: 'mqtt', url: 'tcp://broker:1883', topic: 'openurbanapps/x' },
            scenario: { fields: {} },
            enabled: true,
        },
    })

    it('registers every stream and reports the names with the prefix stripped', async () => {
        const seen: string[] = []
        const outcome = await registerPlanned(
            [planned('inst-1', 'ampel'), planned('inst-1', 'zaehler')],
            'inst-1',
            async (id) => {
                seen.push(id)
            },
        )
        expect(seen).toEqual(['inst-1--ampel', 'inst-1--zaehler'])
        expect(outcome).toEqual({ registered: ['ampel', 'zaehler'], failed: [] })
    })

    it('collects a failure and keeps registering the rest', async () => {
        // The reactivation button leans on this: one dead stream must not veto
        // the other three, and a retry (idempotent PUTs) fills only the gap.
        const outcome = await registerPlanned(
            [planned('inst-1', 'a'), planned('inst-1', 'b'), planned('inst-1', 'c')],
            'inst-1',
            async (id) => {
                if (id.endsWith('--b')) throw new Error('Broker weg')
            },
        )
        expect(outcome.registered).toEqual(['a', 'c'])
        expect(outcome.failed).toEqual([{ streamName: 'b', detail: 'Broker weg' }])
    })
})

describe('assembly topic validation', () => {
    it('rejects a simulation whose topicBase does not match the datasource subscription', () => {
        const pkg = mockPackages.find((candidate) => candidate.manifest.id.includes('luftqualitaet'))!
        expect(() =>
            assembleCatalogEntry(pkg.manifest, (file) => {
                const content = pkg.files[file]
                if (!content) throw new Error(`fixture misses '${file}'`)
                if (file.endsWith('.datasource.json')) {
                    // The subscription drifts away from the scenario's topicBase —
                    // exactly the mismatch that shipped silently before this check.
                    return { ...content, topics: ['openurbanapps/etwas-anderes/+'] }
                }
                return content
            }),
        ).toThrow(/topicBase/)
    })

    it('rejects a stream label too long to fit the simulator name', () => {
        const pkg = mockPackages.find((candidate) => candidate.manifest.id.includes('jungbaum'))!
        expect(() =>
            assembleCatalogEntry(pkg.manifest, (file) => {
                const content = pkg.files[file]
                if (!content) throw new Error(`fixture misses '${file}'`)
                if (file === 'bodenfeuchte.simulation.json') {
                    const streams = content.streams as Record<string, unknown>[]
                    return { ...content, streams: [{ ...streams[0], label: 'x'.repeat(81) }, ...streams.slice(1)] }
                }
                return content
            }),
        ).toThrow(/label/)
    })
})

describe('applyDeclaredUrlOverride', () => {
    it('overrides urls only where the package declares them as a parameter', () => {
        const declared = {
            document: { title: 'A', urls: ['tcp://paket:1883'] },
            parameters: [{ field: 'urls' }],
        }
        const undeclared = { document: { title: 'B', urls: ['tcp://paket:1883'] } }
        const [overridden, untouched] = applyDeclaredUrlOverride(
            [declared, undeclared],
            'tcp://eigene:1883',
        )
        expect(overridden.document.urls).toEqual(['tcp://eigene:1883'])
        // The manifest never offered this source's urls for override.
        expect(untouched.document.urls).toEqual(['tcp://paket:1883'])
    })

    it('every shipped MQTT use case declares the broker override on at least one source', () => {
        // The dialog's "eigene Datenquelle" option is only honest if the packages
        // actually expose the field it overrides. The invariant is scoped to
        // broker-fed packages: a SQL-sourced package has no broker URL, and
        // declaring 'urls' there would let the MQTT-worded custom path corrupt
        // its connection document.
        for (const entry of useCaseEntries()) {
            const hasMqttSource = entry.bundle.dataSources.some(
                (source) => source.document.connectionType === 'mqtt',
            )
            const overridden = applyDeclaredUrlOverride(entry.bundle.dataSources, 'tcp://x:1')
            const changed = overridden.some(
                (source, index) => source !== entry.bundle.dataSources[index],
            )
            expect(changed, entry.manifest.id).toBe(hasMqttSource)
        }
    })

    it('is a no-op for a blank override', () => {
        const sources = [{ document: { urls: ['tcp://paket:1883'] }, parameters: [{ field: 'urls' }] }]
        expect(applyDeclaredUrlOverride(sources, '  ')).toBe(sources)
    })
})

/** The override helpers are generic over any document shape; tests need the wide one. */
type Source = { document: Record<string, unknown>; parameters?: { field: string }[] }

describe('applyDeclaredDsnOverride', () => {
    const demoDsn = 'postgres://demo:geheim@demo-db.core.svc.cluster.local:5432/demo_source'

    it('splits credentials out of the address instead of leaving them in it', () => {
        const declared: Source = {
            document: { title: 'A', dsn: 'postgres://localhost:5432/fachverfahren', user: 'kataster' },
            parameters: [{ field: 'dsn' }, { field: 'user' }, { field: 'password' }],
        }
        const [overridden] = applyDeclaredDsnOverride([declared], demoDsn)
        // The password is a field the platform encrypts; an address carrying
        // user:pass@ would hand it to the registry in clear.
        expect(overridden.document.dsn).toBe(
            'postgres://demo-db.core.svc.cluster.local:5432/demo_source',
        )
        expect(overridden.document.user).toBe('demo')
        expect(overridden.document.password).toBe('geheim')
    })

    it('writes only the fields the package offered', () => {
        const addressOnly: Source = {
            document: { title: 'A', dsn: 'postgres://localhost:5432/fachverfahren', user: 'kataster' },
            parameters: [{ field: 'dsn' }],
        }
        const [overridden] = applyDeclaredDsnOverride([addressOnly], demoDsn)
        expect(overridden.document.dsn).toContain('demo_source')
        // The package keeps its own user: it never offered that field.
        expect(overridden.document.user).toBe('kataster')
        expect(overridden.document.password).toBeUndefined()
    })

    it('leaves sources alone that do not declare dsn', () => {
        const undeclared = { document: { title: 'B', dsn: 'postgres://localhost:5432/fach' } }
        const [untouched] = applyDeclaredDsnOverride([undeclared], demoDsn)
        expect(untouched.document.dsn).toBe('postgres://localhost:5432/fach')
    })

    it('leaves the package default standing when the setting is blank or unparseable', () => {
        const sources = [
            { document: { dsn: 'postgres://localhost:5432/fach' }, parameters: [{ field: 'dsn' }] },
        ]
        expect(applyDeclaredDsnOverride(sources, '   ')).toBe(sources)
        // Half an address written from a typo is worse than no override.
        expect(applyDeclaredDsnOverride(sources, 'not a url')).toBe(sources)
    })

    it('leaves the package default standing when the credentials do not decode', () => {
        const sources = [
            { document: { dsn: 'postgres://localhost:5432/fach' }, parameters: [{ field: 'dsn' }] },
        ]
        // A bare '%' parses as a URL and then fails to decode. That must not
        // abort the install: it is one more unparseable setting.
        expect(
            applyDeclaredDsnOverride(sources, 'postgres://demo:50%rabatt@demo-db:5432/demo_source'),
        ).toBe(sources)
    })

    it('makes the platform read the database the generator writes to', () => {
        // The whole point: D14's guard compares database NAMES, so after the
        // override the planner's readDsn and the generator's DEMO_DB_DSN must
        // name the same database. This is the invariant the SQL demo install
        // silently lacked.
        const [overridden] = applyDeclaredDsnOverride(
            [
                {
                    document: { dsn: 'postgres://localhost:5432/fachverfahren' },
                    parameters: [{ field: 'dsn' }],
                },
            ],
            demoDsn,
        )
        const nameOf = (dsn: string) => new URL(dsn).pathname.replace(/^\//, '')
        expect(nameOf(String(overridden.document.dsn))).toBe(nameOf(demoDsn))
    })
})

describe('resolveDsnOverride', () => {
    const demoDsn = 'postgres://demo:geheim@demo-db:5432/demo_source'

    it('applies the demo database only in demo mode', () => {
        expect(resolveDsnOverride('demo', demoDsn)).toBe(demoDsn)
        // Pointing the platform at an operator's own database is D14's
        // deferred case: the package default stands and is edited in the portal.
        expect(resolveDsnOverride('custom', demoDsn)).toBe('')
        expect(resolveDsnOverride('later', demoDsn)).toBe('')
    })

    it('is inert on deployments that configure no demo database', () => {
        expect(resolveDsnOverride('demo', undefined)).toBe('')
    })
})

/** The planned transport, narrowed — these cases are all MQTT scenarios. */
function mqttTransport(
    transport: { kind: 'mqtt'; url: string; topic: string } | { kind: 'sql'; table: string },
): { url: string; topic: string } {
    if (transport.kind !== 'mqtt') throw new Error('expected an mqtt transport')
    return transport
}
