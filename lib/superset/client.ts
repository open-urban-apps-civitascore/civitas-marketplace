import { importZip, readDashboardDocument } from '@/lib/superset/bundle'
import { bindToInstallation } from '@/lib/superset/rebind'

/**
 * Client for the Superset REST API: the session every write needs, the lookup
 * of the instance's database connection, and the dashboard import.
 */

const FETCH_TIMEOUT_MS = 15000

export interface SupersetConfig {
    /** Where the marketplace reaches the API (on a cluster: the service address). */
    apiUrl: string
    /** Where a browser reaches Superset, for the link in the install result. */
    publicUrl: string
    /**
     * Name of the Superset database connection that reads the platform's data
     * storage. Instance knowledge, so it never travels in a package.
     */
    databaseName: string
    username?: string
    password?: string
    token?: string
}

const setting = (name: string): string | undefined => process.env[name]?.trim() || undefined

/** The settings a dashboard import needs and does not have, by variable name. */
export function missingSupersetSettings(): string[] {
    const missing: string[] = []
    if (!setting('SUPERSET_API_URL')) missing.push('SUPERSET_API_URL')
    if (!setting('SUPERSET_DATABASE_NAME')) missing.push('SUPERSET_DATABASE_NAME')
    if (!setting('SUPERSET_TOKEN') && !(setting('SUPERSET_USERNAME') && setting('SUPERSET_PASSWORD'))) {
        missing.push('SUPERSET_USERNAME/SUPERSET_PASSWORD')
    }
    return missing
}

/** The configuration, or undefined while a setting is missing (see {@link missingSupersetSettings}). */
export function supersetConfig(): SupersetConfig | undefined {
    const rawApiUrl = setting('SUPERSET_API_URL')
    const databaseName = setting('SUPERSET_DATABASE_NAME')
    if (!rawApiUrl || !databaseName || missingSupersetSettings().length > 0) return undefined
    const apiUrl = rawApiUrl.replace(/\/+$/, '')
    return {
        apiUrl,
        publicUrl: (setting('SUPERSET_PUBLIC_URL') ?? apiUrl).replace(/\/+$/, ''),
        databaseName,
        username: setting('SUPERSET_USERNAME'),
        password: setting('SUPERSET_PASSWORD'),
        token: setting('SUPERSET_TOKEN'),
    }
}

/** Where a browser reaches Superset. Enough for links, which need no account. */
export function supersetPublicUrl(): string | undefined {
    return (setting('SUPERSET_PUBLIC_URL') ?? setting('SUPERSET_API_URL'))?.replace(/\/+$/, '')
}

/** The address of a dashboard, by the slug the import gave it. */
export function dashboardUrl(publicUrl: string, slug: string): string {
    return `${publicUrl}/superset/dashboard/${encodeURIComponent(slug)}/`
}

/** The headers every request of one operation carries. */
export interface SupersetSession {
    headers: Record<string, string>
}

async function login(config: SupersetConfig): Promise<string> {
    const response = await fetch(`${config.apiUrl}/api/v1/security/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // provider 'db': an account with a local password. Accounts that only
        // ever signed in through Keycloak have none and cannot log in here.
        body: JSON.stringify({ username: config.username, password: config.password, provider: 'db', refresh: false }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`Superset login: ${response.status} ${response.statusText}`)
    const { access_token: token } = (await response.json()) as { access_token?: string }
    if (!token) throw new Error('Superset login: answer without access_token')
    return token
}

/** `name=value` of every cookie the response sets, as one Cookie header. */
function cookieHeader(headers: Headers): string | undefined {
    const cookies =
        typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie') ?? '']
    const pairs = cookies.map((cookie) => cookie.split(';')[0].trim()).filter(Boolean)
    return pairs.length > 0 ? pairs.join('; ') : undefined
}

/**
 * Logs in and fetches a CSRF token. Superset checks a CSRF token on every
 * POST, bearer-token API calls included, and a token is only valid together
 * with the session cookie of the request that issued it. So the cookie
 * travels along, the way a browser would send it.
 */
export async function openSession(config: SupersetConfig): Promise<SupersetSession> {
    const token = config.token ?? (await login(config))
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` }

    const response = await fetch(`${config.apiUrl}/api/v1/security/csrf_token/`, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`Superset CSRF token: ${response.status} ${response.statusText}`)
    const { result: csrfToken } = (await response.json()) as { result?: string }
    if (!csrfToken) throw new Error('Superset CSRF token: answer without token')

    const cookie = cookieHeader(response.headers)
    return {
        headers: {
            ...headers,
            'X-CSRFToken': csrfToken,
            // Over HTTPS, Superset also requires a referrer from its own origin.
            Referer: `${config.apiUrl}/`,
            ...(cookie ? { Cookie: cookie } : {}),
        },
    }
}

interface DatabaseRow {
    id?: number
    database_name?: string
    uuid?: string
}

/**
 * UUID of the database connection with exactly this name. A Superset instance
 * has a handful of connections, so one page of the list is enough and the
 * name is compared here, independent of the list filter syntax.
 */
export async function findDatabaseUuid(
    config: SupersetConfig,
    session: SupersetSession,
    name: string,
): Promise<string> {
    const get = async (path: string) => {
        const response = await fetch(`${config.apiUrl}${path}`, {
            headers: session.headers,
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (!response.ok) throw new Error(`Superset ${path}: ${response.status} ${response.statusText}`)
        return response.json() as Promise<{ result?: unknown }>
    }

    const list = await get(`/api/v1/database/?q=${encodeURIComponent('(page_size:100)')}`)
    const rows = Array.isArray(list.result) ? (list.result as DatabaseRow[]) : []
    const match = rows.find((row) => row.database_name === name)
    if (!match) throw new Error(`Superset has no database connection named „${name}“`)
    if (match.uuid) return match.uuid

    // Some versions leave the UUID out of the list; the detail answer carries it.
    const detail = await get(`/api/v1/database/${match.id}`)
    const uuid = (detail.result as DatabaseRow | undefined)?.uuid
    if (!uuid) throw new Error(`Superset does not report the UUID of „${name}“`)
    return uuid
}

/** Superset answers errors as `{ message }` or `{ errors: [{ message }] }`; anything else is cut short. */
function errorText(body: string): string {
    try {
        const parsed = JSON.parse(body) as { message?: unknown; errors?: { message?: unknown }[] }
        const messages = [
            ...(typeof parsed.message === 'string' ? [parsed.message] : []),
            ...(parsed.errors ?? []).map((error) => error.message).filter((m): m is string => typeof m === 'string'),
        ]
        if (messages.length > 0) return messages.join('; ')
    } catch {
        // Not JSON: fall through to the raw text.
    }
    return body.slice(0, 300)
}

export async function uploadDashboard(
    config: SupersetConfig,
    session: SupersetSession,
    zip: Buffer,
): Promise<void> {
    const form = new FormData()
    form.append('formData', new Blob([new Uint8Array(zip)], { type: 'application/zip' }), 'dashboard.zip')
    // Overwrite reaches only objects of this installation: the bundle carries installation UUIDs.
    form.append('overwrite', 'true')
    const response = await fetch(`${config.apiUrl}/api/v1/dashboard/import/`, {
        method: 'POST',
        headers: session.headers,
        body: form,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`Superset import: ${response.status} ${errorText(body) || response.statusText}`)
    }
}

export interface InstalledDashboard {
    uuid: string
    title?: string
    url: string
}

/**
 * Imports one packaged dashboard for one installation: checks the package
 * document, binds it to the installation and to the instance's database
 * connection, and uploads it. Throws with a message the install summary shows.
 */
export async function installDashboard(
    content: unknown,
    ids: { installationId: string; datasetId: string },
    config: SupersetConfig,
): Promise<InstalledDashboard> {
    const document = readDashboardDocument(content)
    const session = await openSession(config)
    const databaseUuid = await findDatabaseUuid(config, session, config.databaseName)
    const bound = bindToInstallation(document, { ...ids, databaseUuid })
    await uploadDashboard(config, session, importZip(bound.files))
    return { uuid: bound.uuid, title: bound.title, url: dashboardUrl(config.publicUrl, bound.slug) }
}
