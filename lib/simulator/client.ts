import type { GeneratorSpec } from '@/lib/catalog/types'

/**
 * Thin client for the in-cluster demo-data simulator
 * (civitas-data-source-simulator, service demo-data-generator.demo:4300).
 *
 * Stage A uses only the side-effect-free `POST /sample` (render an
 * unregistered scenario); the registration endpoints follow in stage B. The
 * whole feature is gated on SIMULATOR_API_URL: unset means the simulator is
 * not reachable from this instance and every simulator-backed UI element
 * simply does not render — a demo-day-safe default.
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
