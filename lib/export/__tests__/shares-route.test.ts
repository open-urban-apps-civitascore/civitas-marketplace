import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/session', () => ({
    currentSession: vi.fn(async () => ({ user: { name: 'Ewa' } })),
    accessTokenOrUndefined: vi.fn(async () => 'keycloak-token'),
}))
vi.mock('@/lib/export/share-permission', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/export/share-permission')>()),
    fetchShareRight: vi.fn(async () => 'allowed'),
}))
vi.mock('@/lib/export/share-listing', () => ({
    readShareListing: vi.fn(async () => ({ rows: [{ key: 'k', slug: 'baeume', version: '1.0.0' }], instance: 'https://portal.hier.example' })),
}))

import * as route from '@/app/api/shares/route'
import { readShareListing } from '@/lib/export/share-listing'
import { fetchShareRight, LISTING_HIDDEN_BECAUSE } from '@/lib/export/share-permission'
import { accessTokenOrUndefined, currentSession } from '@/lib/session'

afterEach(() => {
    vi.clearAllMocks()
})

/** The answer as the page's fetch meets it. */
async function call() {
    const response = await route.GET()
    return { response, body: (await response.json()) as { error?: string; rows?: unknown[]; instance?: string } }
}

/** Nothing a browser or a proxy may keep and hand to someone else. */
function expectPrivate(response: Response) {
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('cache-control')).toContain('private')
    expect(response.headers.get('vary')).toContain('Cookie')
    expect(response.headers.get('content-type')).toContain('application/json')
}

describe('GET /api/shares', () => {
    it('answers the listing to someone signed in who may share, asking the portal with the session’s token', async () => {
        const { response, body } = await call()
        expect(response.status).toBe(200)
        expectPrivate(response)
        expect(body).toEqual({ rows: [{ key: 'k', slug: 'baeume', version: '1.0.0' }], instance: 'https://portal.hier.example' })
        expect(fetchShareRight).toHaveBeenCalledWith('keycloak-token')
    })

    it('answers 401 in JSON without a session, never a redirect, and reads nothing', async () => {
        vi.mocked(currentSession).mockResolvedValueOnce(undefined)
        const { response, body } = await call()
        expect(response.status).toBe(401)
        expect(response.headers.get('location')).toBeNull()
        expectPrivate(response)
        expect(body.error).toContain('Anmeldung')
        expect(fetchShareRight).not.toHaveBeenCalled()
        expect(readShareListing).not.toHaveBeenCalled()
    })

    it('answers 401 when the session’s token cannot be renewed', async () => {
        vi.mocked(accessTokenOrUndefined).mockResolvedValueOnce(undefined)
        const { response } = await call()
        expect(response.status).toBe(401)
        expect(readShareListing).not.toHaveBeenCalled()
    })

    it('refuses with 403 whom the platform does not let share, in the words of the pages', async () => {
        vi.mocked(fetchShareRight).mockResolvedValueOnce('refused')
        const { response, body } = await call()
        expect(response.status).toBe(403)
        expectPrivate(response)
        expect(body).toEqual({ error: LISTING_HIDDEN_BECAUSE.refused })
        expect(readShareListing).not.toHaveBeenCalled()
    })

    it('answers 503 when the portal cannot say which right the person has', async () => {
        vi.mocked(fetchShareRight).mockResolvedValueOnce('unknown')
        const { response, body } = await call()
        expect(response.status).toBe(503)
        expect(body).toEqual({ error: LISTING_HIDDEN_BECAUSE.unknown })
        expect(readShareListing).not.toHaveBeenCalled()
    })

    it('only reads: writes stay server actions', () => {
        expect(Object.keys(route)).toEqual(['GET'])
    })
})
