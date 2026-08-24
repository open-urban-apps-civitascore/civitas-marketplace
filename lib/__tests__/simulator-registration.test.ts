import { describe, expect, it } from 'vitest'

import { assembleCatalogEntry } from '@/lib/catalog/assemble'
import type { UseCaseEntry } from '@/lib/catalog/types'
import { applyDeclaredUrlOverride } from '@/lib/install-payload'
import { mockPackages } from '@/lib/mock-catalog'
import { planSimulations, simulationIdPrefix } from '@/lib/simulator/registration'

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

    it('derives ids from the installation prefix and topics from the topic base', () => {
        for (const entry of useCaseEntries()) {
            const planned = planSimulations(entry, INSTALLATION_ID)
            const topicBases = entry.bundle.simulations.map((simulation) => simulation.topicBase)
            for (const { id, input } of planned) {
                // The prefix is the uninstall's only handle on these registrations.
                expect(id.startsWith(simulationIdPrefix(INSTALLATION_ID))).toBe(true)
                // One level below the base — exactly what the datasource's `+` matches.
                const base = topicBases.find((candidate) => input.transport.topic.startsWith(`${candidate}/`))
                expect(base, input.transport.topic).toBeDefined()
                expect(input.transport.topic.slice(base!.length + 1)).not.toContain('/')
                expect(input.enabled).toBe(true)
            }
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

    it('every shipped use case declares the broker override on at least one source', () => {
        // The dialog's "eigene Datenquelle" option is only honest if the packages
        // actually expose the field it overrides.
        for (const entry of useCaseEntries()) {
            const overridden = applyDeclaredUrlOverride(entry.bundle.dataSources, 'tcp://x:1')
            const changed = overridden.some(
                (source, index) => source !== entry.bundle.dataSources[index],
            )
            expect(changed, entry.manifest.id).toBe(true)
        }
    })

    it('is a no-op for a blank override', () => {
        const sources = [{ document: { urls: ['tcp://paket:1883'] }, parameters: [{ field: 'urls' }] }]
        expect(applyDeclaredUrlOverride(sources, '  ')).toBe(sources)
    })
})
