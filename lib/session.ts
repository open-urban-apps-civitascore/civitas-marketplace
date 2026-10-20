import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getToken } from 'next-auth/jwt'
import { auth } from '@/auth'
import { sessionCookieName } from '@/auth.config'
import { isTokenExpired, refreshAccessToken } from '@/lib/tokenUtils'

/**
 * Guard for authenticated pages. Every protected page calls this itself — the
 * surrounding layout cannot do it on their behalf: layouts are cached on the
 * client and do not re-render when navigating between routes that share them,
 * so a check placed there would not run again after the first load.
 */
export async function requireSession() {
    const session = await currentSession()
    if (!session) redirect('/login')
    return session
}

/**
 * The signed-in session, or undefined where `requireSession` would send the
 * person to the login. For route handlers: a fetch from the page cannot
 * follow a redirect to a login page, it needs a 401 it can tell apart.
 */
export async function currentSession() {
    const session = await auth()
    return session && !session.error ? session : undefined
}

/**
 * The Keycloak access token for server-side backend calls. It lives only in the
 * encrypted session cookie and is never exposed to the browser.
 *
 * Access tokens live ~5 minutes, and Server Components cannot write cookies —
 * so the stored token WILL be stale for any session older than that. Instead
 * of failing with 401s, an expired token is exchanged on the fly via the
 * refresh token; the cookie stays stale, which is harmless (the exchange just
 * repeats per request) until a proxy.ts persists refreshes centrally.
 */
export async function getAccessToken(): Promise<string> {
    const token = await accessTokenOrUndefined()
    if (!token) redirect('/login')
    return token
}

/** {@link getAccessToken} without the redirect: undefined where it would send the person to the login, for route handlers. */
export async function accessTokenOrUndefined(): Promise<string | undefined> {
    const requestHeaders = await headers()
    const secureCookie = requestHeaders.get('x-forwarded-proto') === 'https'
    const token = await getToken({
        req: { headers: requestHeaders },
        secret: process.env.NEXTAUTH_SECRET,
        secureCookie,
        // Must match the namespaced name from auth.config.ts — getToken looks the
        // cookie up by name and would otherwise find nothing.
        cookieName: sessionCookieName(secureCookie),
    })
    if (!token?.access_token) return undefined

    if (isTokenExpired(token.expires_at)) {
        const refreshed = await refreshAccessToken(token)
        if (refreshed.error || !refreshed.access_token) return undefined
        return refreshed.access_token
    }
    return token.access_token
}
