import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { createZip, readZip } from './zip'

/**
 * Client for the Apache Superset REST API.
 * Orchestrates native dashboard imports, dynamic rebinding of database schemas,
 * and lifecycle management directly from the marketplace without touching portal-backend.
 */

const FETCH_TIMEOUT_MS = 15000

export interface SupersetConfig {
    apiUrl: string
    publicUrl: string
    username?: string
    password?: string
    token?: string
}

export function supersetConfig(): SupersetConfig | undefined {
    const raw = process.env.SUPERSET_API_URL?.trim()
    if (!raw) return undefined
    const apiUrl = raw.replace(/\/+$/, '')
    const publicUrl = (process.env.SUPERSET_PUBLIC_URL?.trim() || apiUrl).replace(/\/+$/, '')
    return {
        apiUrl,
        publicUrl,
        username: process.env.SUPERSET_USERNAME?.trim() || 'admin',
        password: process.env.SUPERSET_PASSWORD?.trim() || 'admin',
        token: process.env.SUPERSET_TOKEN?.trim(),
    }
}

export function isSupersetConfigured(): boolean {
    return supersetConfig() !== undefined
}

export function supersetPublicUrl(): string | undefined {
    return supersetConfig()?.publicUrl
}

export interface RebindOptions {
    datasetId?: string
    schema?: string
    table?: string
    database?: string
}

export interface RebindResult {
    zipBuffer: Buffer
    dashboardSlug?: string
    dashboardTitle?: string
}

/**
 * Unpacks an exported Superset dashboard bundle, replaces instance-specific
 * references (the generated dataset schema `ds_<uuid>` and target database),
 * and repacks the ZIP for import.
 */
export function rebindSupersetZip(zipBuffer: Buffer, options: RebindOptions): RebindResult {
    const files = readZip(zipBuffer)
    let dashboardSlug: string | undefined
    let dashboardTitle: string | undefined

    const effectiveSchema = options.schema
        ? options.schema.replace(/\${datasetId}/g, options.datasetId ? options.datasetId.replace(/-/g, '_') : '')
        : options.datasetId
          ? `ds_${options.datasetId.replace(/-/g, '_')}`
          : undefined

    for (const [path, contentBuf] of Object.entries(files)) {
        const text = contentBuf.toString('utf-8')

        if (path.startsWith('dashboards/') && (path.endsWith('.yaml') || path.endsWith('.yml'))) {
            try {
                const doc = parseYaml(text) as Record<string, unknown>
                if (typeof doc.slug === 'string' && doc.slug) dashboardSlug = doc.slug
                if (typeof doc.dashboard_title === 'string') dashboardTitle = doc.dashboard_title
            } catch {
                // Ignore parse errors on individual metadata
            }
        }

        if (path.startsWith('datasets/') && (path.endsWith('.yaml') || path.endsWith('.yml'))) {
            try {
                const doc = parseYaml(text) as Record<string, unknown>
                let changed = false

                if (effectiveSchema && doc.schema !== effectiveSchema) {
                    doc.schema = effectiveSchema
                    changed = true
                }
                if (options.table && doc.table_name !== options.table) {
                    doc.table_name = options.table
                    changed = true
                }
                if (changed) {
                    files[path] = Buffer.from(stringifyYaml(doc), 'utf-8')
                }
            } catch {
                // Ignore parse errors on dataset metadata
            }
        }
    }

    return {
        zipBuffer: createZip(files),
        dashboardSlug,
        dashboardTitle,
    }
}

interface SupersetAuth {
    token: string
    csrfToken?: string
}

async function authenticate(config: SupersetConfig): Promise<SupersetAuth> {
    if (config.token) {
        return { token: config.token }
    }

    const loginRes = await fetch(`${config.apiUrl}/api/v1/security/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: config.username,
            password: config.password,
            provider: 'db',
            refresh: true,
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).catch((err) => {
        throw new Error(`Superset login request failed: ${err instanceof Error ? err.message : String(err)}`)
    })

    if (!loginRes.ok) {
        throw new Error(`Superset authentication failed with status ${loginRes.status}`)
    }

    const loginData = (await loginRes.json()) as { access_token?: string }
    const token = loginData.access_token
    if (!token) {
        throw new Error('Superset login succeeded but returned no access_token')
    }

    // Attempt to fetch CSRF token (required when CSRF protection is enabled)
    let csrfToken: string | undefined
    try {
        const csrfRes = await fetch(`${config.apiUrl}/api/v1/security/csrf_token/`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (csrfRes.ok) {
            const csrfData = (await csrfRes.json()) as { result?: string }
            csrfToken = csrfData.result
        }
    } catch {
        // CSRF might be disabled, proceed without it
    }

    return { token, csrfToken }
}

export interface ImportDashboardResult {
    ok: boolean
    dashboardUrl?: string
    dashboardTitle?: string
    error?: string
}

/**
 * Uploads a dashboard ZIP bundle to Superset via the native /api/v1/dashboard/import/ endpoint.
 */
export async function importDashboard(
    zipBuffer: Buffer,
    options: {
        datasetId?: string
        schema?: string
        table?: string
        database?: string
        overwrite?: boolean
        passwords?: Record<string, string>
    } = {},
): Promise<ImportDashboardResult> {
    const config = supersetConfig()
    if (!config) {
        return { ok: false, error: 'SUPERSET_API_URL is not configured' }
    }

    const { zipBuffer: finalZip, dashboardSlug, dashboardTitle } = rebindSupersetZip(zipBuffer, {
        datasetId: options.datasetId,
        schema: options.schema,
        table: options.table,
        database: options.database,
    })

    try {
        const auth = await authenticate(config)
        const formData = new FormData()
        const blob = new Blob([new Uint8Array(finalZip)], { type: 'application/zip' })
        formData.append('formData', blob, 'dashboard_bundle.zip')
        formData.append('overwrite', options.overwrite !== false ? 'true' : 'false')
        if (options.passwords) {
            formData.append('passwords', JSON.stringify(options.passwords))
        }

        const headers: Record<string, string> = {
            Authorization: `Bearer ${auth.token}`,
        }
        if (auth.csrfToken) {
            headers['X-CSRFToken'] = auth.csrfToken
        }

        const importRes = await fetch(`${config.apiUrl}/api/v1/dashboard/import/`, {
            method: 'POST',
            headers,
            body: formData,
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })

        if (!importRes.ok) {
            const errText = await importRes.text().catch(() => '')
            return {
                ok: false,
                error: `Superset import failed (${importRes.status}): ${errText || importRes.statusText}`,
            }
        }

        const publicDashboardUrl = dashboardSlug
            ? `${config.publicUrl}/superset/dashboard/${encodeURIComponent(dashboardSlug)}/`
            : `${config.publicUrl}/dashboard/list/`

        return {
            ok: true,
            dashboardUrl: publicDashboardUrl,
            dashboardTitle,
        }
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        }
    }
}

/**
 * Deletes a dashboard by its Superset ID.
 */
export async function deleteDashboard(id: number | string): Promise<{ ok: boolean; error?: string }> {
    const config = supersetConfig()
    if (!config) return { ok: false, error: 'SUPERSET_API_URL is not configured' }

    try {
        const auth = await authenticate(config)
        const headers: Record<string, string> = {
            Authorization: `Bearer ${auth.token}`,
        }
        if (auth.csrfToken) {
            headers['X-CSRFToken'] = auth.csrfToken
        }

        const res = await fetch(`${config.apiUrl}/api/v1/dashboard/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers,
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })

        if (!res.ok && res.status !== 404) {
            const errText = await res.text().catch(() => '')
            return { ok: false, error: `Superset delete failed (${res.status}): ${errText}` }
        }
        return { ok: true }
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
}
