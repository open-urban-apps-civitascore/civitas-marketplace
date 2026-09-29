import { NextResponse } from 'next/server'

import { auth } from '@/auth'

/**
 * Runs on every navigation (Next 16's rename of middleware; Node runtime).
 * Two jobs, ported from the portal's middleware:
 *
 * 1. Optimistic redirect: signed-out visitors go to /login, signed-in visitors
 *    don't linger on /login. Pages still call requireSession() themselves —
 *    the proxy is convenience, not the security boundary.
 * 2. Session persistence: the auth() wrapper runs the jwt callback and writes
 *    the (possibly refreshed) session cookie back to the response — the one
 *    place that may do so. This keeps the stored access token fresh, so the
 *    on-the-fly refresh in getAccessToken() stays a rare fallback instead of
 *    a per-request Keycloak roundtrip.
 */
export default auth((req) => {
    const { nextUrl } = req
    // `session.user` is built from the token unconditionally, so a session whose
    // refresh failed still carries a user. Without the error check this guard
    // would call that "signed in" while requireSession() calls it "signed out",
    // and the two would bounce the browser between /login and /use-cases until
    // it gave up with ERR_TOO_MANY_REDIRECTS.
    const isLoggedIn = !!req.auth?.user && !req.auth.error
    const isLoginPage = nextUrl.pathname === '/login'

    if (!isLoggedIn && !isLoginPage) {
        return NextResponse.redirect(new URL('/login', nextUrl))
    }
    if (isLoggedIn && isLoginPage) {
        return NextResponse.redirect(new URL('/use-cases', nextUrl))
    }
    return NextResponse.next()
})

export const config = {
    // Everything except the NextAuth routes, static assets and files.
    matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
