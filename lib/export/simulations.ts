import { simulationProblem } from '@/lib/catalog/assemble'
import type { BundledMqttSimulation, BundledSimulation, BundledSqlSimulation, SimulationStream } from '@/lib/catalog/types'
import type { InstanceSnapshot, SnapshotSource } from '@/lib/export/portal-reader'
import { logicalUrn, slugify } from '@/lib/export/urn'
import type { SimulationDetail } from '@/lib/simulator/client'

/**
 * Demo data for a shared package, read back from the simulator.
 *
 * Demo data is written in one place, the simulator: an install registers a
 * package's scenarios there, and its own interface creates streams by hand. A
 * share only chooses among the streams that feed the dataset's sources and
 * turns them back into the package's simulation members, the reverse of
 * planSimulations (lib/simulator/registration.ts). Everything that belongs to
 * the instance stays behind: broker and database addresses, ids, installation.
 *
 * A stream belongs to a source by its recorded origin (the install writes it,
 * and so may the simulator interface), or, for a stream without one, by its
 * address: an MQTT topic the source subscribes to, or the table it reads. A
 * stream whose origin names another source is that source's, even when the
 * address would match, so a copy installed next to its original does not
 * claim the original's demo data.
 */

export interface DemoStream {
    id: string
    label: string
    /** 'origin': recorded by the install or the simulator; 'address': same topic or table. */
    matchedBy: 'origin' | 'address'
}

export interface DemoSource {
    id: string
    name: string
    transport: 'mqtt' | 'sql'
    /** The source's structure, for a link that starts a new stream from it. */
    structureUrn?: string
    streams: DemoStream[]
    /**
     * 'no-topic': an MQTT source that subscribes to nothing. A package derives
     * each stream's topic from the subscription, so its streams cannot travel -
     * known at once, instead of only when the package is built.
     */
    problem?: 'no-topic'
    /** Where the source is fixed in the portal; built on the server, which knows the portal's address. */
    portalHref?: string
}

type Transport = DemoSource['transport']

function transportOf(source: SnapshotSource): Transport | undefined {
    const kind = source.connectorType.toLowerCase()
    return kind === 'mqtt' || kind === 'sql' ? kind : undefined
}

function topicsOf(source: SnapshotSource): string[] {
    const topics = source.configuration.topics
    return Array.isArray(topics) ? topics.filter((topic): topic is string => typeof topic === 'string') : []
}

/**
 * The Topic a source's demo streams publish under: its first subscription. One
 * rule for the inventory and the export, so a source the inventory offers is
 * never one the export then leaves out. An empty string is no Topic.
 */
function subscriptionOf(source: SnapshotSource): string | undefined {
    return topicsOf(source)[0] || undefined
}

/** MQTT filter matching: `+` stands for one level, a trailing `#` for any rest. */
export function topicMatches(filter: string, topic: string): boolean {
    const want = filter.split('/')
    const have = topic.split('/')
    for (let i = 0; i < want.length; i++) {
        if (want[i] === '#') return true
        if (i >= have.length || (want[i] !== '+' && want[i] !== have[i])) return false
    }
    return want.length === have.length
}

function belongsTo(detail: SimulationDetail, source: SnapshotSource, transport: Transport): DemoStream['matchedBy'] | undefined {
    const recorded = (detail.origin ?? detail.input?.origin)?.dataSource
    // A name alone identifies nothing; only an id or a URN is a recorded origin.
    if (recorded?.id || recorded?.urn) {
        const sameId = recorded.id === source.id
        const sameUrn = !!recorded.urn && !!source.configurationUrn && logicalUrn(recorded.urn) === logicalUrn(source.configurationUrn)
        return sameId || sameUrn ? 'origin' : undefined
    }
    const address = detail.input?.transport
    if (address?.kind === 'mqtt' && transport === 'mqtt') {
        return topicsOf(source).some((filter) => topicMatches(filter, address.topic)) ? 'address' : undefined
    }
    if (address?.kind === 'sql' && transport === 'sql') {
        return typeof source.configuration.table === 'string' && address.table === source.configuration.table ? 'address' : undefined
    }
    return undefined
}

/** A package label's limit; the simulator allows longer names, so a label is cut to fit. */
const LABEL_MAX = 80

/** The install names a stream `<dataset> · <label>`; the package carries the label alone. */
function labelOf(detail: SimulationDetail): string {
    const name = (detail.input?.name ?? detail.name ?? detail.id).trim()
    const cut = name.indexOf(' · ')
    const label = (cut >= 0 ? name.slice(cut + 3) : name).trim() || detail.id
    return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1).trimEnd()}…` : label
}

/** The streams of the simulator that feed each MQTT or SQL source of the dataset. */
export function demoSources(snapshot: InstanceSnapshot, details: SimulationDetail[]): DemoSource[] {
    return snapshot.sources.flatMap((source): DemoSource[] => {
        const transport = transportOf(source)
        if (!transport) return []
        const structure = snapshot.structures.find((candidate) => candidate.versionId === source.structureVersionId)
        const streams = details.flatMap((detail): DemoStream[] => {
            const matchedBy = belongsTo(detail, source, transport)
            return matchedBy && detail.input?.scenario ? [{ id: detail.id, label: labelOf(detail), matchedBy }] : []
        })
        return [{
            id: source.id,
            name: source.name,
            transport,
            ...(structure ? { structureUrn: logicalUrn(structure.modelUrn) } : {}),
            streams: streams.sort((a, b) => a.label.localeCompare(b.label, 'de')),
            ...(transport === 'mqtt' && !subscriptionOf(source) ? { problem: 'no-topic' as const } : {}),
        }]
    })
}

/**
 * The message class a scenario instantiates, found the way the install checks
 * it: the first class the scenario's fields fit. The class the root points at
 * comes first, so a structure that keeps its message in $defs is named as its
 * authors do (`#/$defs/Messung`), then the root itself, then every other class.
 */
function withMessageClass<T extends BundledSimulation>(
    simulation: T,
    model: Record<string, unknown>,
): { simulation: T; problem?: string } {
    const defs = model.$defs && typeof model.$defs === 'object' ? Object.keys(model.$defs) : []
    const pointed = typeof model.$ref === 'string' && model.$ref.startsWith('#/') ? [model.$ref] : []
    const candidates = [...new Set([...pointed, '#', ...defs.map((name) => `#/$defs/${name}`)])]
    let first: string | undefined
    for (const messageClass of candidates) {
        const candidate = { ...simulation, messageClass }
        const problem = simulationProblem(candidate, model)
        if (!problem) return { simulation: candidate }
        first ??= problem
    }
    // No class fits: keep the first candidate, and let the package check say why.
    return { simulation: { ...simulation, messageClass: candidates[0] }, problem: first }
}

function uniqueName(name: string, taken: Set<string>): string {
    let candidate = name || 'stream'
    for (let n = 2; taken.has(candidate); n++) candidate = `${name}-${n}`
    taken.add(candidate)
    return candidate
}

/**
 * The package's simulation members for the chosen streams. Chosen ids that do
 * not feed a source of this dataset are ignored: the choice comes from a form,
 * and the server decides again what belongs to the dataset.
 */
export function simulationMembers(
    snapshot: InstanceSnapshot,
    details: SimulationDetail[],
    chosen: ReadonlySet<string>,
): { simulations: BundledSimulation[]; warnings: string[] } {
    const simulations: BundledSimulation[] = []
    const warnings: string[] = []
    const byId = new Map(details.map((detail) => [detail.id, detail]))

    const sources = demoSources(snapshot, details)
    const feeding = new Set(sources.flatMap((demo) => demo.streams.map((stream) => stream.id)))
    const missing = [...chosen].filter((id) => !feeding.has(id))
    if (missing.length) {
        warnings.push(`${missing.length === 1 ? 'Ein gewählter Datenstrom gehört' : `${missing.length} gewählte Datenströme gehören`} nicht (mehr) zu diesem Use Case und ${missing.length === 1 ? 'fehlt' : 'fehlen'} im Paket: ${missing.join(', ')}`)
    }
    for (const demo of sources) {
        const picked = demo.streams.filter((stream) => chosen.has(stream.id)).map((stream) => byId.get(stream.id) as SimulationDetail)
        if (!picked.length) continue
        const source = snapshot.sources.find((candidate) => candidate.id === demo.id) as SnapshotSource
        const model = snapshot.structures.find((candidate) => candidate.versionId === source.structureVersionId)?.model
        if (!model) {
            warnings.push(`Demo-Daten für ${demo.name}: die Quelle nennt keine Struktur - ausgelassen`)
            continue
        }

        let built: { simulation: BundledSimulation; problem?: string }
        if (demo.transport === 'sql') {
            const [detail, ...rest] = picked
            if (rest.length) warnings.push(`Demo-Daten für ${demo.name}: eine Tabelle hat eine Simulation - nur „${labelOf(detail)}“ kommt ins Paket`)
            const scenario = detail.input?.scenario
            if (!scenario?.table || scenario.maxRows === undefined) {
                warnings.push(`Demo-Daten für ${demo.name}: „${labelOf(detail)}“ beschreibt keine Tabelle oder keine Höchstzahl an Zeilen - ausgelassen`)
                continue
            }
            const sql: BundledSqlSimulation = {
                transport: 'sql',
                sourceRef: source.name,
                messageClass: '#',
                label: labelOf(detail),
                table: scenario.table,
                fields: scenario.fields,
                ...(scenario.cadence ? { cadence: scenario.cadence } : {}),
                ...(scenario.seedRows !== undefined ? { seedRows: scenario.seedRows } : {}),
                ...(scenario.insertsPerTick !== undefined ? { insertsPerTick: scenario.insertsPerTick } : {}),
                maxRows: scenario.maxRows,
                ...(scenario.intervalSeconds !== undefined ? { intervalSeconds: scenario.intervalSeconds } : {}),
            }
            built = withMessageClass(sql, model)
        } else {
            const subscription = subscriptionOf(source)
            if (!subscription) {
                warnings.push(`Demo-Daten für ${demo.name}: die Quelle abonniert kein Topic - ausgelassen`)
                continue
            }
            // The install derives each stream's topic from the subscription, so only its base travels.
            const topicBase = subscription.endsWith('/+') || subscription.endsWith('/#') ? subscription.slice(0, -2) : subscription
            const intervals = [...new Set(picked.map((detail) => detail.input?.scenario.intervalSeconds ?? detail.intervalSeconds))]
            if (intervals.length > 1) {
                warnings.push(`Demo-Daten für ${demo.name}: die Datenströme senden in verschiedenen Takten (${intervals.join(', ')} s) - das Paket nimmt ${intervals[0]} s für alle`)
            }
            const taken = new Set<string>()
            const streams: SimulationStream[] = picked.map((detail) => {
                const recorded = (detail.origin ?? detail.input?.origin)?.stream
                const fromId = detail.id.includes('--') ? detail.id.slice(detail.id.lastIndexOf('--') + 2) : undefined
                return {
                    name: uniqueName(slugify(recorded ?? fromId ?? labelOf(detail)), taken),
                    label: labelOf(detail),
                    fields: detail.input?.scenario.fields ?? {},
                }
            })
            const mqtt: BundledMqttSimulation = {
                sourceRef: source.name,
                messageClass: '#',
                topicBase,
                ...(intervals[0] !== undefined ? { intervalSeconds: intervals[0] } : {}),
                streams,
            }
            built = withMessageClass(mqtt, model)
        }
        if (built.problem) warnings.push(`Demo-Daten für ${demo.name} passen nicht zur Struktur der Quelle: ${built.problem}`)
        simulations.push(built.simulation)
    }
    return { simulations, warnings }
}
