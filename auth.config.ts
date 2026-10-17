import type { NextAuthConfig } from 'next-auth'
import { isTokenExpired, refreshAccessToken } from '@/lib/tokenUtils'

// The marketplace and the CIVITAS portal both run on `localhost` in dev.
// Browser cookies are scoped by HOSTNAME, not port, so with the default names
// the two apps overwrite each other's auth cookies — and since each app has its
// own secret, neither can decrypt the other's, throwing both sessions out.
// Server Components cannot write cookies, so this only bites on the first
// action that can (a server action, e.g. the install button).
const COOKIE_PREFIX = 'marketplace'
const useSecureCookies = process.env.NODE_ENV === 'production'
const cookieName = (name: string) =>
    `${useSecureCookies ? '__Secure-' : ''}${COOKIE_PREFIX}.${name}`

const baseCookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: useSecureCookies,
}

/** The session cookie's name, for `getToken()` which looks it up by name. */
export const sessionCookieName = (secure: boolean) =>
    `${secure ? '__Secure-' : ''}${COOKIE_PREFIX}.session-token`

export const authConfig = {
    session: { strategy: 'jwt', maxAge: 10 * 60 * 60 },
    pages: { signIn: '/login' },
    cookies: {
        sessionToken: { name: cookieName('session-token'), options: baseCookieOptions },
        callbackUrl: { name: cookieName('callback-url'), options: baseCookieOptions },
        csrfToken: {
            name: `${useSecureCookies ? '__Host-' : ''}${COOKIE_PREFIX}.csrf-token`,
            options: baseCookieOptions,
        },
        pkceCodeVerifier: {
            name: cookieName('pkce.code_verifier'),
            options: { ...baseCookieOptions, maxAge: 60 * 15 },
        },
        state: {
            name: cookieName('state'),
            options: { ...baseCookieOptions, maxAge: 60 * 15 },
        },
        nonce: { name: cookieName('nonce'), options: baseCookieOptions },
    },
    callbacks: {
        async jwt({ token, account }) {
            if (account) {
                // first login: move keycloak tokens in (enscrypted - via NEXT_AUTH_SECRET) session cookie
                return {
                    ...token,
                    access_token: account.access_token,
                    expires_at: account.expires_at,
                    refresh_token: account.refresh_token,
                    id_token: account.id_token,
                }
            }
            if (!isTokenExpired(token.expires_at)) return token
            const refreshed = await refreshAccessToken(token)
            // Returning null is what makes Auth.js call sessionStore.clean() and
            // drop the session cookie — including every chunk (.0/.1) and with
            // the right __Secure- attributes. Middleware cannot do this: the
            // auth() wrapper appends its own Set-Cookie after the handler's, so
            // a delete there is simply overwritten. Only a terminal rejection
            // clears; an unreachable Keycloak keeps the token for a retry.
            if (refreshed.error === 'RefreshTokenExpired') return null
            return refreshed
        },
        session({ session, token }) {
            return { ...session, error: token.error }
        },
    },
    events: {
        // also terminate Keycloak session (not only the local cookie)
        async signOut(message) {
            if ('token' in message && message.token?.id_token) {
                const params = new URLSearchParams({ id_token_hint: message.token.id_token as string })
                await fetch(`${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect/logout?${params}`)
            }
        },
    },
    providers: [], // will be in auth.ts
} satisfies NextAuthConfig