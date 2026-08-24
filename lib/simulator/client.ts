import type { GeneratorSpec } from '@/lib/catalog/types'

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
}

/**
 * Renders an unregistered scenario's next records without publishing anything.
 * The simulator walks the clock forward by the real interval, so dailyProfile
 * curves visibly move across the returned records.
 */
export async function fetchSample(scenario: SampleScenario, count = 5): Promise<Record<string, unknown>[]> {
    const base = simulatorApiUrl()
    if (!base) throw new SimulatorError('SIMULATOR_API_URL is not configured', 0)

    const response = await fetch(`${base}/sample`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario, count }),
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).catch((error) => {
        throw new SimulatorError(
            `Simulator nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`,
            0,
        )
    })

    if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new SimulatorError(body?.error ?? `Simulator antwortet mit ${response.status}`, response.status)
    }
    const body = (await response.json()) as { records?: Record<string, unknown>[] }
    return body.records ?? []
}

/** Wire shape of `PUT /simulations/:id` — the simulator's `simulationInputSchema`. */
export interface SimulationInput {
    transport: { kind: 'mqtt'; url: string; topic: string }
    scenario: SampleScenario
    enabled: boolean
}

async function simulatorRequest(path: string, init: RequestInit): Promise<Response> {
    const base = simulatorApiUrl()
    if (!base) throw new SimulatorError('SIMULATOR_API_URL is not configured', 0)
    return fetch(`${base}${path}`, {
        ...init,
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
    const response = await simulatorRequest('/simulations', { method: 'GET' })
    if (!response.ok) throw await rejectionOf(response)
    const body = (await response.json()) as { simulations?: { id?: unknown }[] }
    return (body.simulations ?? [])
        .map((simulation) => simulation.id)
        .filter((id): id is string => typeof id === 'string')
}
