import { isSqlSimulation } from '@/lib/catalog/types'
import type { BundledDataSource, UseCaseEntry } from '@/lib/catalog/types'
import { slugify } from '@/lib/export/urn'
import type { InstallationReceipt, InstalledArtifactLine } from '@/lib/install-payload'
import type {
    ArtifactRef,
    SimulationInput,
    SimulationOrigin,
    SimulationStatus,
} from '@/lib/simulator/client'

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
 *
 * The id stays a key. What a person reads comes from the installation record
 * the platform keeps (`installation`): the stream is named after its dataset,
 * and its origin carries the portal artifacts it feeds with their ids. Without
 * the record — the platform could not be read — the names come from the
 * package, and the origin carries no ids.
 */
export function planSimulations(
    entry: UseCaseEntry,
    installationId: string,
    brokerUrlOverride?: string,
    installation?: InstallationReceipt,
): PlannedSimulation[] {
    return entry.bundle.simulations.flatMap((simulation): PlannedSimulation[] => {
        const source = entry.bundle.dataSources.find(
            (candidate) => candidate.document.title === simulation.sourceRef,
        )
        const describe = (label: string, stream?: string) =>
            describeStream({ entry, source, sourceRef: simulation.sourceRef, installationId, installation, label, stream })

        if (isSqlSimulation(simulation)) {
            const table = source?.document.table
            if (typeof table !== 'string' || !table) {
                throw new Error(
                    `Simulation '${simulation.sourceRef}': Datenquelle nennt keine Tabelle, die befüllt werden könnte`,
                )
            }
            const readDsn = typeof source?.document.dsn === 'string' ? source.document.dsn : undefined
            return [
                {
                    id: `${simulationIdPrefix(installationId)}${slugify(simulation.sourceRef)}`,
                    input: {
                        ...describe(simulation.label ?? simulation.sourceRef),
                        transport: { kind: 'sql' as const, table, ...(readDsn ? { readDsn } : {}) },
                        scenario: {
                            ...(simulation.intervalSeconds !== undefined
                                ? { intervalSeconds: simulation.intervalSeconds }
                                : {}),
                            table: simulation.table,
                            fields: simulation.fields,
                            ...(simulation.cadence !== undefined ? { cadence: simulation.cadence } : {}),
                            ...(simulation.seedRows !== undefined ? { seedRows: simulation.seedRows } : {}),
                            ...(simulation.insertsPerTick !== undefined
                                ? { insertsPerTick: simulation.insertsPerTick }
                                : {}),
                            maxRows: simulation.maxRows,
                        },
                        enabled: true,
                    },
                },
            ]
        }

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
                ...describe(stream.label ?? readableStreamName(stream.name), stream.name),
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

/**
 * The simulator's limits. It refuses a registration that exceeds one, and a
 * refused registration is demo data that never starts, so the names are cut to
 * fit and an over-long URN is left out rather than sent broken.
 */
const NAME_MAX = 200
const URN_MAX = 500

const fit = (text: string): string => text.slice(0, NAME_MAX)

/**
 * `zaehlstelle-promenade` → `Zaehlstelle Promenade`: the fallback when the
 * package gives a stream no label. It cannot restore an umlaut, which is what
 * the label is for.
 */
export function readableStreamName(slug: string): string {
    return slug
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
}

function artifactRef(line: InstalledArtifactLine | undefined): ArtifactRef | undefined {
    if (!line?.name) return undefined
    return {
        name: fit(line.name),
        ...(line.urn && line.urn.length <= URN_MAX ? { urn: line.urn } : {}),
        ...(line.shellId ? { id: line.shellId } : {}),
    }
}

/** The installed copy of a bundle member, found by the URN it carried in the package. */
function installedCopy(
    installation: InstallationReceipt | undefined,
    artifactType: string,
    packageUrn: unknown,
): ArtifactRef | undefined {
    if (typeof packageUrn !== 'string') return undefined
    return artifactRef(
        installation?.artifacts?.find((line) => line.artifactType === artifactType && line.origin === packageUrn),
    )
}

/**
 * Name, description and origin of one stream, from the names the portal shows.
 * A person reads the match in the name; the simulator's UI makes it by the ids
 * in the origin.
 */
function describeStream({
    entry,
    source,
    sourceRef,
    installationId,
    installation,
    label,
    stream,
}: {
    entry: UseCaseEntry
    source: BundledDataSource | undefined
    sourceRef: string
    installationId: string
    installation: InstallationReceipt | undefined
    label: string
    stream: string | undefined
}): Pick<SimulationInput, 'name' | 'description' | 'origin'> {
    const useCase = {
        id: entry.manifest.id,
        name: fit(entry.manifest.displayName),
        version: installation?.packageVersion ?? entry.manifest.version,
    }
    const dataSetUrn = installation?.artifacts?.find((line) => line.artifactType === 'DATA_SET')?.urn
    const dataSet: ArtifactRef | undefined = installation?.dataSetName
        ? {
              name: fit(installation.dataSetName),
              ...(dataSetUrn && dataSetUrn.length <= URN_MAX ? { urn: dataSetUrn } : {}),
              ...(installation.dataSetId ? { id: installation.dataSetId } : {}),
          }
        : undefined
    const element = source?.document.element
    const bundledStructure = entry.bundle.dataStructures.find((candidate) => candidate.model.$id === element)
    const dataSource = installedCopy(installation, 'DATA_SOURCE', source?.document.id) ?? { name: fit(sourceRef) }
    const dataStructure =
        installedCopy(installation, 'DATA_STRUCTURE', element) ??
        (bundledStructure ? { name: fit(bundledStructure.name) } : undefined)

    const origin: SimulationOrigin = {
        installationId,
        useCase,
        ...(dataSet ? { dataSet } : {}),
        dataSource,
        ...(dataStructure ? { dataStructure } : {}),
        ...(stream ? { stream } : {}),
    }
    // The structure's name stays in the prose: a simulator UI from before the
    // origin finds a stream's structure by searching the description.
    const description =
        `Demo-Daten für die Datenquelle „${dataSource.name}“` +
        (dataSet ? ` im Datensatz „${dataSet.name}“` : '') +
        (dataStructure ? `, Datenstruktur „${dataStructure.name}“` : '') +
        `. Use Case ${useCase.name} ${useCase.version}. Simuliert, nicht gemessen.`
    return {
        name: fit(`${dataSet?.name ?? useCase.name} · ${label}`),
        description,
        origin,
    }
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

/** Per-stream outcome of pushing a plan into the registry. */
export interface RegistrationOutcome {
    /** Stream names (id minus prefix) that are now registered. */
    registered: string[]
    failed: { streamName: string; detail: string }[]
}

/**
 * Pushes a plan into the registry through the given register function,
 * collecting per-stream failures instead of stopping at the first: the PUTs
 * are idempotent, so a partial pass followed by a retry converges — but only
 * if the caller learns WHICH streams are still missing. IO stays injected,
 * keeping this module free of transport concerns (and testable without one).
 */
export async function registerPlanned(
    planned: PlannedSimulation[],
    installationId: string,
    register: (id: string, input: SimulationInput) => Promise<void>,
): Promise<RegistrationOutcome> {
    const prefix = simulationIdPrefix(installationId)
    const registered: string[] = []
    const failed: { streamName: string; detail: string }[] = []
    for (const { id, input } of planned) {
        try {
            await register(id, input)
            registered.push(id.slice(prefix.length))
        } catch (error) {
            failed.push({
                streamName: id.slice(prefix.length),
                detail: error instanceof Error ? error.message : String(error),
            })
        }
    }
    return { registered, failed }
}
