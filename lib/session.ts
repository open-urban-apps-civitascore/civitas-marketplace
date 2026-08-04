import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getToken } from 'next-auth/jwt'
import { auth } from '@/auth'

/**
 * Guard for authenticated pages. Every protected page calls this itself — the
 * surrounding layout cannot do it on their behalf: layouts are cached on the
 * client and do not re-render when navigating between routes that share them,
 * so a check placed there would not run again after the first load.
 */
export async function requireSession() {
    const session = await auth()
    if (!session || session.error) redirect('/login')
    return session
}

/**
 * The Keycloak access token for server-side backend calls. It lives only in the
 * encrypted session cookie and is never exposed to the browser.
 */
export async function getAccessToken(): Promise<string> {
    const requestHeaders = await headers()
    const token = await getToken({
        req: { headers: requestHeaders },
        secret: process.env.NEXTAUTH_SECRET,
        secureCookie: requestHeaders.get('x-forwarded-proto') === 'https',
    })
    if (!token?.access_token) redirect('/login')
    return token.access_token
}
