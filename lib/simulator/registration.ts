import type { BundledDataSource, UseCaseEntry } from '@/lib/catalog/types'
import type { SimulationInput, SimulationStatus } from '@/lib/simulator/client'

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
 * stream: id `<installationId>--<streamName>`; the publish topic derives from
 * the DATASOURCE's subscription — it is the authority on where the installed
 * platform actually listens. A `x/+` (or `x/#`) subscription puts every
 * stream on its own subtopic, `x/<streamName>`; an exact subscription puts
 * all streams on exactly `x`. Publishing `topicBase/<stream>` unconditionally
 * once fed an exact-subscribing source a topic level it never received —
 * perfectly running streams, zero rows [live 2026-08-24].
 *
 * The broker URL comes from the datasource document the scenario names
 * (`urls[0]`, the instance-local default the install just provisioned), unless
 * the caller overrides it — needed when the simulator runs outside the docker
 * network and the package's container-name URL does not resolve for it.
 *
 * Throws on an unresolvable broker or subscription instead of skipping: a
 * silently skipped stream would report a successful demo activation that
 * publishes nothing.
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
        const topicFor = topicPlanner(source, simulation.sourceRef)
        return simulation.streams.map((stream) => ({
            id: `${simulationIdPrefix(installationId)}${stream.name}`,
            input: {
                transport: {
                    kind: 'mqtt' as const,
                    url: brokerUrl,
                    topic: topicFor(stream.name),
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

/** Publish-topic rule for one datasource: subtopic per stream under a wildcard, verbatim otherwise. */
function topicPlanner(
    source: BundledDataSource | undefined,
    sourceRef: string,
): (streamName: string) => string {
    const topics = source?.document.topics
    const subscription = Array.isArray(topics) && typeof topics[0] === 'string' ? topics[0] : undefined
    if (!subscription) {
        throw new Error(`Simulation '${sourceRef}': Datenquelle nennt keine MQTT-Topics`)
    }
    if (subscription.endsWith('/+') || subscription.endsWith('/#')) {
        const prefix = subscription.slice(0, -2)
        return (streamName) => `${prefix}/${streamName}`
    }
    return () => subscription
}

function firstUrlOf(source: BundledDataSource | undefined): string | undefined {
    const urls = source?.document.urls
    if (!Array.isArray(urls)) return undefined
    const first = urls[0]
    return typeof first === 'string' && first.trim() ? first : undefined
}

/** One installation's stream, with the display name the id prefix hides. */
export interface InstallationStream {
    /** The stream name as authored in the package — the id minus the prefix. */
    streamName: string
    status: SimulationStatus
}

/**
 * The read-side counterpart of {@link planSimulations}: which of the
 * simulator's registrations belong to this installation? Matching by the id
 * prefix (never by substring — `abc` must not claim `abc2--…`) keeps this in
 * step with the uninstall sweep: whatever the sweep would delete, the panel
 * shows, including streams a since-changed package version no longer names.
 */
export function streamsOfInstallation(
    all: SimulationStatus[],
    installationId: string,
): InstallationStream[] {
    const prefix = simulationIdPrefix(installationId)
    return all
        .filter((status) => status.id.startsWith(prefix))
        .map((status) => ({ streamName: status.id.slice(prefix.length), status }))
        .sort((a, b) => a.streamName.localeCompare(b.streamName))
}
