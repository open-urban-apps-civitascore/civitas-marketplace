import { afterEach, describe, expect, it, vi } from 'vitest'

import { datapoolHref } from '@/lib/portal-links'

afterEach(() => {
    vi.unstubAllEnvs()
})

describe('datapoolHref', () => {
    it('points at the portal of the dev stack when nothing is configured', () => {
        vi.stubEnv('PORTAL_URL', '')

        expect(datapoolHref('pool-1')).toBe('http://localhost:3000/datapools/pool-1')
    })

    it('uses the configured portal and tolerates a trailing slash', () => {
        vi.stubEnv('PORTAL_URL', 'https://portal.example.org/')

        expect(datapoolHref('pool-1')).toBe('https://portal.example.org/datapools/pool-1')
    })

    it('escapes the id', () => {
        vi.stubEnv('PORTAL_URL', 'https://portal.example.org')

        expect(datapoolHref('a b')).toBe('https://portal.example.org/datapools/a%20b')
    })
})
