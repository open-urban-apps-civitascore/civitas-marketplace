import type { GeneratorSpec } from '@/lib/catalog/types'
import { getAccessToken } from '@/lib/session'

/**
 * Thin client for the in-cluster demo-data simulator
 * (civitas-data-source-simulator, service demo-data-generator.demo:4300).
 *
 * Stage A uses the side-effect-free `POST /sample` (render an unregistered
 * scenario); stage B adds the registration surface: `PUT /simulations/:id`
 * (idempotent — the id is ours, so a retry converges), `DELETE` (404 counts
 * as done) and the listing the uninstall sweeps by id prefix. The whole
 * feature is gated on SIMULATOR_API_URL: unset means the simulator is not
 * reachable from this instance and every simulator-backed UI element simply
 * does not render — a demo-day-safe default.
 */

const FETCH_TIMEOUT_MS = 5000

export function simulatorApiUrl(): string | undefined {
    const raw = process.env.SIMULATOR_API_URL?.trim()
    return raw ? raw.replace(/\/+$/, '') : undefined
}

export function isSimulatorConfigured(): boolean {
    return simulatorApiUrl() !== undefined
}

export class SimulatorError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message)
        this.name = 'SimulatorError'
    }
}

export interface SampleScenario {
    intervalSeconds?: number
    fields: Record<string, GeneratorSpec>
    table?: { columns: Record<string, string>; primaryKey?: string }
    cadence?: 'interval' | 'fillToLimit'
    seedRows?: number
    insertsPerTick?: number
    maxRows?: number
}

/**
 * Renders an unregistered scenario's next records without publishing anything.
 * The simulator walks the clock forward by the real interval, so dailyProfile
 * curves visibly move across the returned records.
 */
export async function fetchSample(scenario: SampleScenario, count = 5): Promise<Record<string, unknown>[]> {
    const response = await simulatorRequest('/sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario, count }),
    })
    if (!response.ok) throw await rejectionOf(response)
    const body = (await response.json()) as { records?: Record<string, unknown>[] }
    return body.records ?? []
}

/** A portal artifact: the name the portal shows, and the ids that find it. */
export interface ArtifactRef {
    name: string
    /** Logical CORE URN of the installed copy. */
    urn?: string
    /** The portal's own id (the artifact's shell). */
    id?: string
}

/**
 * What a stream belongs to on the platform, so a person can find it next to
 * the portal's artifacts and the simulator's UI can match it by id. A snapshot:
 * every registration replaces it.
 */
export interface SimulationOrigin {
    installationId?: string
    useCase?: { id: string; name: string; version?: string }
    dataSet?: ArtifactRef
    dataSource?: ArtifactRef
    dataStructure?: ArtifactRef
    /** The stream's name in the package. */
    stream?: string
}

/** Wire shape of `PUT /simulations/:id` — the simulator's `simulationInputSchema`. */
export interface SimulationInput {
    /** What a person reads; the id stays the technical key. */
    name?: string
    description?: string
    origin?: SimulationOrigin
    transport:
        | { kind: 'mqtt'; url: string; topic: string }
        | { kind: 'sql'; table: string; readDsn?: string }
    scenario: SampleScenario
    enabled: boolean
}

async function simulatorRequest(path: string, init: RequestInit = {}): Promise<Response> {
    const base = simulatorApiUrl()
    if (!base) throw new SimulatorError('SIMULATOR_API_URL is not configured', 0)

    const accessToken = await getAccessToken()

    return fetch(`${base}${path}`, {
        ...init,
        headers: {
            ...((init.headers as Record<string, string> | undefined) ?? {}),
            Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).catch((error) => {
        throw new SimulatorError(
            `Simulator nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`,
            0,
        )
    })
}

async function rejectionOf(response: Response): Promise<SimulatorError> {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    return new SimulatorError(body?.error ?? `Simulator antwortet mit ${response.status}`, response.status)
}

/**
 * Creates or replaces one publisher. PUT semantics are the whole point: the id
 * is ours (`<installationId>--<stream>`), so a retried install converges on the
 * same publisher instead of stacking a second one onto the broker.
 */
export async function registerSimulation(id: string, input: SimulationInput): Promise<void> {
    const response = await simulatorRequest(`/simulations/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    })
    if (!response.ok) throw await rejectionOf(response)
}

/** Removes one publisher; an already-absent id (404) counts as removed. */
export async function deleteSimulation(id: string): Promise<void> {
    const response = await simulatorRequest(`/simulations/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!response.ok && response.status !== 404) throw await rejectionOf(response)
}

/**
 * The ids of every registered simulation. The uninstall sweeps this by id
 * prefix rather than recomputing stream names from the package: the installed
 * version may since have changed its streams, and a sweep cannot orphan what
 * a recomputation would miss.
 */
export async function listSimulationIds(): Promise<string[]> {
    return (await listSimulations()).map((simulation) => simulation.id)
}

/**
 * The simulator's live record per publisher (its registry `SimulationStatus`).
 * `lastPayload` is the last message actually handed to the broker — not a
 * preview — which is what makes the installed-page panel honest: it shows
 * published traffic, not what a scenario would hypothetically render.
 */
export interface SimulationStatus {
    id: string
    /** What the registration named it; absent from simulators older than the names. */
    name?: string | null
    origin?: SimulationOrigin | null
    enabled: boolean
    topic: string
    url: string
    intervalSeconds: number
    createdAt: string
    publishedCount: number
    lastPublishedAt: string | null
    lastPayload: Record<string, unknown> | null
    lastError: string | null
}

/** Every registered simulation with its live publish state. */
export async function listSimulations(): Promise<SimulationStatus[]> {
    const response = await simulatorRequest('/simulations', { method: 'GET' })
    if (!response.ok) throw await rejectionOf(response)
    const body = (await response.json()) as { simulations?: unknown[] }
    return (body.simulations ?? []).filter(
        (simulation): simulation is SimulationStatus =>
            typeof simulation === 'object' &&
            simulation !== null &&
            typeof (simulation as { id?: unknown }).id === 'string',
    )
}

/**
 * Pauses or resumes one publisher and returns its refreshed state. The
 * registration survives a switch-off — only publishing stops — so the panel's
 * toggle is freely reversible, unlike DELETE.
 */
export async function switchSimulation(id: string, on: boolean): Promise<SimulationStatus> {
    const response = await simulatorRequest(
        `/simulations/${encodeURIComponent(id)}/${on ? 'switch_on' : 'switch_off'}`,
        { method: 'POST' },
    )
    if (!response.ok) throw await rejectionOf(response)
    return (await response.json()) as SimulationStatus
}
