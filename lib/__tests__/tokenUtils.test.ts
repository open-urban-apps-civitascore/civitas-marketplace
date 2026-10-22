import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JWT } from 'next-auth/jwt'

import { isTokenExpired, refreshAccessToken } from '@/lib/tokenUtils'

/**
 * The distinction these tests pin down is what keeps a signed-in user from
 * being thrown out by a hiccup: only a verdict FROM Keycloak (4xx) discards the
 * session — an unreachable or broken Keycloak keeps it for the next attempt.
 * The jwt callback turns `RefreshTokenExpired` into `null`, which is what makes
 * Auth.js clear the session cookie, so getting this wrong either strands a dead
 * cookie or logs people out during a blip.
 */

const TOKEN: JWT = {
    access_token: 'old-access',
    refresh_token: 'the-refresh-token',
    expires_at: 1,
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

beforeEach(() => {
    vi.stubEnv('KEYCLOAK_ISSUER', 'https://idm.example/realms/core')
    vi.stubEnv('KEYCLOAK_CLIENT_ID', 'marketplace')
    vi.stubEnv('KEYCLOAK_CLIENT_SECRET', 'shhh')
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe('refreshAccessToken', () => {
    it('returns the refreshed tokens and clears any previous error', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(
                jsonResponse({
                    access_token: 'new-access',
                    expires_in: 300,
                    refresh_token: 'new-refresh',
                }),
            ),
        )

        const result = await refreshAccessToken({ ...TOKEN, error: 'RefreshTokenError' })

        expect(result.access_token).toBe('new-access')
        expect(result.refresh_token).toBe('new-refresh')
        expect(result.error).toBeUndefined()
        expect(result.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000))
    })

    it('keeps the old refresh token when Keycloak does not rotate it', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(jsonResponse({ access_token: 'new-access', expires_in: 300 })),
        )

        const result = await refreshAccessToken(TOKEN)

        expect(result.refresh_token).toBe('the-refresh-token')
    })

    it('marks a rejected grant as terminal so the session gets discarded', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, 400)),
        )

        const result = await refreshAccessToken(TOKEN)

        expect(result.error).toBe('RefreshTokenExpired')
        // The token is still handed back: the caller decides what to discard.
        expect(result.refresh_token).toBe('the-refresh-token')
    })

    it('treats a failing Keycloak as retryable, not as a logout', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 503 })))

        const result = await refreshAccessToken(TOKEN)

        expect(result.error).toBe('RefreshTokenError')
    })

    it('treats an unreachable Keycloak as retryable, not as a logout', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

        const result = await refreshAccessToken(TOKEN)

        expect(result.error).toBe('RefreshTokenError')
        expect(result.refresh_token).toBe('the-refresh-token')
    })
})

describe('isTokenExpired', () => {
    it('treats a missing expiry as expired', () => {
        expect(isTokenExpired(undefined)).toBe(true)
    })

    it('expires a token slightly early so it is not used mid-flight', () => {
        const inThirtySeconds = Math.floor(Date.now() / 1000) + 30
        expect(isTokenExpired(inThirtySeconds)).toBe(true)
    })

    it('accepts a token that is comfortably valid', () => {
        const inTenMinutes = Math.floor(Date.now() / 1000) + 600
        expect(isTokenExpired(inTenMinutes)).toBe(false)
    })
})
