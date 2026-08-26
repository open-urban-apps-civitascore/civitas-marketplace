import { describe, expect, it } from 'vitest'

import { assembleCatalogEntry } from '@/lib/catalog/assemble'
import type { UseCaseEntry } from '@/lib/catalog/types'
import { applyDeclaredUrlOverride } from '@/lib/install-payload'
import { mockPackages } from '@/lib/mock-catalog'
import {
    planSimulations,
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
    it('plans one registration per bundled stream, for every shipped use case', () => {
        for (const entry of useCaseEntries()) {
            const planned = planSimulations(entry, INSTALLATION_ID)
            const streamCount = entry.bundle.simulations.reduce(
                (sum, simulation) => sum + simulation.streams.length,
                0,
            )
            expect(planned, entry.manifest.id).toHaveLength(streamCount)
        }
    })

    it('derives ids from the installation prefix and topics from the datasource subscription', () => {
        for (const entry of useCaseEntries()) {
            const planned = planSimulations(entry, INSTALLATION_ID)
            const subscriptions = entry.bundle.dataSources
                .map((source) => (Array.isArray(source.document.topics) ? source.document.topics[0] : undefined))
                .filter((topic): topic is string => typeof topic === 'string')
            for (const { id, input } of planned) {
                // The prefix is the uninstall's only handle on these registrations.
                expect(id.startsWith(simulationIdPrefix(INSTALLATION_ID))).toBe(true)
                expect(input.enabled).toBe(true)
                // The subscription decides: wildcard → own subtopic per stream,
                // exact → the exact topic. Either way every published message is
                // one the installed source actually receives.
                const matches = subscriptions.some((subscription) =>
                    subscription.endsWith('/+') || subscription.endsWith('/#')
                        ? input.transport.topic.startsWith(subscription.slice(0, -1)) &&
                          !input.transport.topic.slice(subscription.length - 1).includes('/')
                        : input.transport.topic === subscription,
                )
                expect(matches, `${entry.manifest.id}: ${input.transport.topic}`).toBe(true)
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
            expect(input.transport.topic).toBe(subscription[0])
        }
    })

    it('takes the broker from the datasource the scenario names', () => {
        for (const entry of useCaseEntries()) {
            for (const { input } of planSimulations(entry, INSTALLATION_ID)) {
                const declaredUrls = entry.bundle.dataSources.flatMap((source) =>
                    Array.isArray(source.document.urls) ? (source.document.urls as string[]) : [],
                )
                expect(declaredUrls, entry.manifest.id).toContain(input.transport.url)
            }
        }
    })

    it('lets a broker override win over the package value', () => {
        const [entry] = useCaseEntries()
        for (const { input } of planSimulations(entry, INSTALLATION_ID, 'tcp://localhost:1883')) {
            expect(input.transport.url).toBe('tcp://localhost:1883')
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
