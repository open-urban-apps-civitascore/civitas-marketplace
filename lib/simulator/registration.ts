import type { BundledDataSource, UseCaseEntry } from '@/lib/catalog/types'
import type { SimulationInput } from '@/lib/simulator/client'

/**
 * Pure planning for stage B: which simulator registrations does an install of
 * this entry imply? Separate from the server action for the same reason as
 * `install-payload.ts` — a `'use server'` module cannot export synchronous
 * helpers, and this mapping is exactly the kind of seam worth pinning with
 * tests: ids, topics and broker resolution decide whether demo data reaches
 * the installed datasource or a topic nobody subscribes to.
 */

/**
 * Every simulation of an installation shares this id prefix, so the uninstall
 * can sweep `GET /simulations` for `<installationId>--*` without a lookup
 * table — and without recomputing stream names from a package version that
 * may have changed since the install.
 */
export function simulationIdPrefix(installationId: string): string {
    return `${installationId}--`
}

export interface PlannedSimulation {
    id: string
    input: SimulationInput
}

/**
 * Maps the entry's bundled scenarios onto simulator registrations, one per
 * stream: id `<installationId>--<streamName>`, topic `<topicBase>/<streamName>`
 * — the shape the bundled datasource's `topicBase/+` subscription matches.
 *
 * The broker URL comes from the datasource document the scenario names
 * (`urls[0]`, the instance-local default the install just provisioned), unless
 * the caller overrides it — needed when the simulator runs outside the docker
 * network and the package's container-name URL does not resolve for it.
 *
 * Throws on an unresolvable broker instead of skipping: a silently skipped
 * stream would report a successful demo activation that publishes nothing.
 */
export function planSimulations(
    entry: UseCaseEntry,
    installationId: string,
    brokerUrlOverride?: string,
): PlannedSimulation[] {
    return entry.bundle.simulations.flatMap((simulation) => {
        const source = entry.bundle.dataSources.find(
            (candidate) => candidate.document.title === simulation.sourceRef,
        )
        const brokerUrl = brokerUrlOverride?.trim() || firstUrlOf(source)
        if (!brokerUrl) {
            throw new Error(
                `Simulation '${simulation.sourceRef}': Datenquelle nennt keine Broker-URL und kein Override ist gesetzt`,
            )
        }
        return simulation.streams.map((stream) => ({
            id: `${simulationIdPrefix(installationId)}${stream.name}`,
            input: {
                transport: {
                    kind: 'mqtt' as const,
                    url: brokerUrl,
                    topic: `${simulation.topicBase}/${stream.name}`,
                },
                scenario: {
                    ...(simulation.intervalSeconds !== undefined
                        ? { intervalSeconds: simulation.intervalSeconds }
                        : {}),
                    fields: stream.fields,
                },
                enabled: true,
            },
        }))
    })
}

function firstUrlOf(source: BundledDataSource | undefined): string | undefined {
    const urls = source?.document.urls
    if (!Array.isArray(urls)) return undefined
    const first = urls[0]
    return typeof first === 'string' && first.trim() ? first : undefined
}
