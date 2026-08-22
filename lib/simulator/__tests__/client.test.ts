import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchSample, isSimulatorConfigured, SimulatorError } from '@/lib/simulator/client'
import { mockPackages } from '@/lib/mock-catalog'
import type { BundledSimulation } from '@/lib/catalog/types'

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

beforeEach(() => {
    vi.stubEnv('SIMULATOR_API_URL', 'http://sim.example:4300')
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe('simulator client', () => {
    it('is hidden entirely when no URL is configured', () => {
        vi.stubEnv('SIMULATOR_API_URL', '')
        expect(isSimulatorConfigured()).toBe(false)
    })

    it('posts a bundled fixture scenario to /sample exactly as authored', async () => {
        const traffic = mockPackages.find(
            (pkg) => pkg.manifest.id === 'urn:openurbanapps:usecase:verkehrszaehlung',
        )!
        const simulation = traffic.files['zaehlstellen.simulation.json'] as unknown as BundledSimulation

        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ records: [{ counterId: 'Z-001' }] }))
        vi.stubGlobal('fetch', fetchMock)

        const records = await fetchSample(
            { intervalSeconds: simulation.intervalSeconds, fields: simulation.streams[0].fields },
            3,
        )

        expect(records).toEqual([{ counterId: 'Z-001' }])
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe('http://sim.example:4300/sample')
        const body = JSON.parse(String(init.body)) as {
            count: number
            scenario: { fields: Record<string, { kind: string }> }
        }
        expect(body.count).toBe(3)
        // The wire payload carries the catalogue's generator specs verbatim —
        // the simulator's zod schema is the shared contract.
        expect(body.scenario.fields.vehicleCount.kind).toBe('dailyProfile')
        expect(body.scenario.fields.timestamp.kind).toBe('now')
    })

    it('surfaces the simulator error body on a non-ok response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'kaputt' }, 422)))
        await expect(fetchSample({ fields: {} })).rejects.toThrow('kaputt')
    })

    it('reports an unreachable simulator as a SimulatorError, not a crash', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
        await expect(fetchSample({ fields: {} })).rejects.toBeInstanceOf(SimulatorError)
    })
})
