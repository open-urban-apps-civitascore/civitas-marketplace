import type { JWT } from 'next-auth/jwt'

export function isTokenExpired(expiresAt?: number): boolean {
    if (!expiresAt) return true
    return Date.now() >= (expiresAt - 60) * 1000 // 60s Puffer
}

export async function refreshAccessToken(token: JWT): Promise<JWT> {
    const issuer = process.env.KEYCLOAK_INTERNAL_ISSUER ?? process.env.KEYCLOAK_ISSUER!
    const res = await fetch(`${issuer}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.KEYCLOAK_CLIENT_ID!,
            client_secret: process.env.KEYCLOAK_CLIENT_SECRET!,
            grant_type: 'refresh_token',
            refresh_token: token.refresh_token as string,
        }),
    })
    if (!res.ok) return { ...token, error: 'RefreshTokenError' }
    const t = await res.json()
    return {
        ...token,
        access_token: t.access_token,
        expires_at: Math.floor(Date.now() / 1000) + t.expires_in,
        refresh_token: t.refresh_token ?? token.refresh_token,
        error: undefined,
    }
}