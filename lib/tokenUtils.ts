import type { JWT } from 'next-auth/jwt'

export function isTokenExpired(expiresAt?: number): boolean {
    if (!expiresAt) return true
    return Date.now() >= (expiresAt - 60) * 1000 // 60s Puffer
}

/**
 * Exchanges the refresh token for a fresh access token.
 *
 * The two failure modes are kept apart on purpose, because the caller reacts
 * differently: `RefreshTokenExpired` means Keycloak rejected the grant itself
 * (refresh token expired or revoked, client secret rotated) — retrying can
 * never succeed, so the session is discarded. `RefreshTokenError` means we
 * could not reach a verdict (Keycloak unreachable or erroring); the refresh
 * token may still be good, so it is kept and the next request retries.
 */
export async function refreshAccessToken(token: JWT): Promise<JWT> {
    const issuer = process.env.KEYCLOAK_INTERNAL_ISSUER ?? process.env.KEYCLOAK_ISSUER!
    let res: Response
    try {
        res = await fetch(`${issuer}/protocol/openid-connect/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.KEYCLOAK_CLIENT_ID!,
                client_secret: process.env.KEYCLOAK_CLIENT_SECRET!,
                grant_type: 'refresh_token',
                refresh_token: token.refresh_token as string,
            }),
        })
    } catch {
        // Network/DNS failure — no verdict from Keycloak, so keep the session.
        return { ...token, error: 'RefreshTokenError' }
    }
    if (!res.ok) {
        // 4xx is Keycloak refusing the grant (`invalid_grant` and friends);
        // 5xx is Keycloak having a bad day and worth retrying.
        const rejected = res.status >= 400 && res.status < 500
        return { ...token, error: rejected ? 'RefreshTokenExpired' : 'RefreshTokenError' }
    }
    const t = await res.json()
    return {
        ...token,
        access_token: t.access_token,
        expires_at: Math.floor(Date.now() / 1000) + t.expires_in,
        refresh_token: t.refresh_token ?? token.refresh_token,
        error: undefined,
    }
}