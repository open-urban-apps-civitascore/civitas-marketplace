import { afterEach, describe, expect, it, vi } from 'vitest'

import { simulationUiHref, simulatorUiUrl } from '@/lib/simulator/ui-links'

describe('simulatorUiUrl', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('drops trailing slashes', () => {
        vi.stubEnv('SIMULATOR_UI_URL', 'https://simulator.example.org//')
        expect(simulatorUiUrl()).toBe('https://simulator.example.org')
    })

    it('is undefined when unset or blank, so no link renders', () => {
        vi.stubEnv('SIMULATOR_UI_URL', '  ')
        expect(simulatorUiUrl()).toBeUndefined()
    })
})

describe('simulationUiHref', () => {
    it('links the simulation page by its full id, prefix included', () => {
        expect(simulationUiHref('http://localhost:3003', 'a1b2--zaehlstelle-1')).toBe(
            'http://localhost:3003/simulations/a1b2--zaehlstelle-1',
        )
    })

    it('encodes a stream name that is not URL-safe', () => {
        expect(simulationUiHref('http://localhost:3003', 'a1b2--Zählstelle Nord')).toBe(
            'http://localhost:3003/simulations/a1b2--Z%C3%A4hlstelle%20Nord',
        )
    })
})
