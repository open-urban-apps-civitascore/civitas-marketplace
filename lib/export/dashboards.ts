import { fetchInstalledDashboards } from '@/lib/installed-dashboards'
import {
    DashboardDocumentError,
    dashboardTitle,
    readDashboardDocument,
    type SupersetDashboardDocument,
} from '@/lib/superset/bundle'

/**
 * Dashboards in the share flow.
 *
 * The marketplace never reads Superset itself. The platform exports a
 * dashboard of the dataset (`GET /v1/datasets/{id}/visualizations/{vid}/export`,
 * checked with the user's token) and cleans it there. This module asks for
 * that export and checks it a second time before it goes into a package,
 * because sharing publishes it. The check refuses what must not travel;
 * `neutralizeDashboard` (used by the package transform) rebuilds what the
 * receiving instance replaces anyway: the database connection.
 */

/** A dashboard of the dataset as the share dialog offers it. */
export interface DashboardChoice {
    /** The platform's id of the dashboard. */
    id: string
    title: string
    /** Superset has it, so the platform can export it. */
    inSuperset: boolean
}

/** A dashboard that passed the check, ready for the package. */
export interface SharedDashboard {
    title: string
    document: SupersetDashboardDocument
}

/**
 * Export format versions this check knows (`metadata.yaml` → `version`). An
 * unknown version is refused, so a new Superset format is looked at before it
 * is shared, instead of fields nobody checked going out unseen.
 */
export const KNOWN_EXPORT_VERSIONS: readonly string[] = ['1.0.0']

/** Largest dashboard document a package takes, serialized. */
export const MAX_DASHBOARD_BYTES = 512 * 1024

/** Field names that carry credentials; matched case-insensitively as substrings (as in lib/export/transform). */
const SECRET_KEY = /(password|passwd|secret|token|api[-_]?key|credential|private[-_]?key|client[-_]?secret)/i

/** `scheme://user:password@host`, the password part captured. */
const CREDENTIAL_IN_URL = /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:([^\s/@]+)@/i

/** A value Superset or the platform already masked. */
const MASKED = /^(X{3,}|\*{3,})$/

/** The only database fields the package keeps; the receiving instance binds its own connection. */
const DATABASE_FIELDS = ['database_name', 'uuid', 'version'] as const

const DASHBOARD_ID = /^[A-Za-z0-9-]{1,64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Superset exports `extra` as a mapping; older exports carry it as a JSON string. */
function extraOf(dataset: Record<string, unknown>): Record<string, unknown> {
    const extra = dataset.extra
    if (isRecord(extra)) return extra
    if (typeof extra === 'string' && extra.trim()) {
        try {
            const parsed: unknown = JSON.parse(extra)
            return isRecord(parsed) ? parsed : {}
        } catch {
            return {}
        }
    }
    return {}
}

/** Where in a file a secret sits, as `key` or `key.nested`; JSON kept in strings (query_context) is read too. */
function findSecret(value: unknown, at = ''): string | undefined {
    if (typeof value === 'string') {
        // JSON first, so a finding inside it names its key (query_context.…).
        const text = value.trim()
        if (text.startsWith('{') || text.startsWith('[')) {
            try {
                return findSecret(JSON.parse(text), at)
            } catch {
                // Not JSON after all: read it as text below.
            }
        }
        const credential = CREDENTIAL_IN_URL.exec(value)
        return credential && !MASKED.test(credential[1]) ? at || 'value' : undefined
    }
    if (Array.isArray(value)) {
        for (const [index, item] of value.entries()) {
            const found = findSecret(item, `${at}[${index}]`)
            if (found) return found
        }
        return undefined
    }
    if (!isRecord(value)) return undefined
    for (const [key, item] of Object.entries(value)) {
        const path = at ? `${at}.${key}` : key
        if (SECRET_KEY.test(key) && typeof item === 'string' && item.trim() && !MASKED.test(item.trim())) return path
        const found = findSecret(item, path)
        if (found) return found
    }
    return undefined
}

/**
 * The second check of an exported dashboard. Returns the document with its
 * title, or the reason it must not go into a package. The database files are
 * not scanned for secrets here: `neutralizeDashboard` rebuilds them from an
 * allowlist, so nothing of the instance's connection travels.
 */
export function checkSharedDashboard(
    value: unknown,
    where = 'Dashboard',
): { dashboard: SharedDashboard } | { refusal: string } {
    let document: SupersetDashboardDocument
    try {
        document = readDashboardDocument(value, where)
    } catch (error) {
        return { refusal: error instanceof DashboardDocumentError ? error.message : String(error) }
    }
    const version = document.files['metadata.yaml']?.version
    if (typeof version !== 'string' || !KNOWN_EXPORT_VERSIONS.includes(version)) {
        return {
            refusal: `Exportformat ${JSON.stringify(version ?? null)} ist unbekannt (bekannt: ${KNOWN_EXPORT_VERSIONS.join(', ')}). Ein neues Format wird erst geprüft, dann geteilt`,
        }
    }
    if (Buffer.byteLength(JSON.stringify(document), 'utf8') > MAX_DASHBOARD_BYTES) {
        return { refusal: `größer als ${MAX_DASHBOARD_BYTES / 1024} KB` }
    }
    const databases = Object.keys(document.files).filter((path) => path.startsWith('databases/'))
    if (databases.length > 1) {
        return { refusal: `liest ${databases.length} Datenbanken, geteilt wird nur eine, gebunden an die Verbindung der Plattform` }
    }
    for (const [path, file] of Object.entries(document.files)) {
        if (path.startsWith('datasets/')) {
            const sql = file.sql
            if (typeof sql === 'string' && sql.trim() && typeof extraOf(file).frostView !== 'string') {
                return { refusal: `'${path}' liest mit einer eigenen SQL-Abfrage. Geteilt werden nur Tabellen und die FROST-Sichten der Plattform` }
            }
        }
        if (path.startsWith('databases/')) continue
        const secret = findSecret(file)
        if (secret) return { refusal: `'${path}' enthält Zugangsdaten (${secret})` }
    }
    const title = dashboardTitle(document) ?? 'Dashboard'
    return { dashboard: { title, document } }
}

/**
 * The document as the package keeps it: every database file reduced to the
 * fields that name it. Its address, user, password and engine settings stay
 * behind; the receiving instance binds the dashboard to its own connection
 * (the platform's binder) and writes that connection back after the import.
 * Reports whether a removed address carried a password.
 */
export function neutralizeDashboard(document: SupersetDashboardDocument): {
    document: SupersetDashboardDocument
    credentialRemoved: boolean
} {
    let credentialRemoved = false
    const files = Object.fromEntries(
        Object.entries(document.files).map(([path, file]) => {
            if (!path.startsWith('databases/')) return [path, file]
            const uri = typeof file.sqlalchemy_uri === 'string' ? file.sqlalchemy_uri : ''
            if (CREDENTIAL_IN_URL.test(uri)) credentialRemoved = true
            const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(uri)?.[1] ?? 'trino'
            const kept: Record<string, unknown> = {}
            for (const field of DATABASE_FIELDS) {
                if (field in file) kept[field] = file[field]
            }
            return [path, { ...kept, sqlalchemy_uri: `${scheme}://` }]
        }),
    )
    return { document: { ...document, files }, credentialRemoved }
}

/** The dashboards of a dataset for the share dialog, read from the platform with the user's token. */
export async function dashboardChoices(datasetId: string, accessToken: string): Promise<DashboardChoice[]> {
    const dashboards = await fetchInstalledDashboards(datasetId, accessToken)
    return dashboards.map(({ id, title, externalId }) => ({ id, title, inSuperset: externalId !== undefined }))
}

/** The platform's answer for one export: the document, or why there is none. */
export type DashboardExport = { ok: true; document: unknown } | { ok: false; reason: string }

/** Says why the platform gave no export, in the words of the preview. */
function exportFailure(status: number, detail: string | undefined): string {
    if (status === 403) return 'keine Berechtigung, dieses Dashboard zu teilen'
    if (status === 404 || status === 405 || status === 501) {
        return 'die Plattform bietet den Export noch nicht an oder kennt das Dashboard nicht'
    }
    if (status === 409) return 'Superset hat das Dashboard noch nicht angelegt. Erst nach der Freigabe teilbar'
    if (status === 504) return 'Superset hat nicht rechtzeitig geantwortet'
    return detail ? `${status}: ${detail}` : `Antwort ${status}`
}

/** Asks the platform for one dashboard's export, with the user's token. */
export async function fetchDashboardExport(
    accessToken: string,
    datasetId: string,
    dashboardId: string,
): Promise<DashboardExport> {
    if (!DASHBOARD_ID.test(dashboardId)) return { ok: false, reason: 'ungültige Kennung' }
    let response: Response
    try {
        response = await fetch(
            `${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/datasets/${encodeURIComponent(datasetId)}/visualizations/${encodeURIComponent(dashboardId)}/export`,
            { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' },
        )
    } catch (error) {
        return { ok: false, reason: `Portal-Backend nicht erreichbar (${error instanceof Error ? error.message : String(error)})` }
    }
    if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as { detail?: unknown } | null
        const detail = typeof problem?.detail === 'string' ? problem.detail : undefined
        return { ok: false, reason: exportFailure(response.status, detail) }
    }
    try {
        return { ok: true, document: (await response.json()) as unknown }
    } catch {
        return { ok: false, reason: 'die Antwort der Plattform ist kein JSON' }
    }
}

/**
 * The chosen dashboards of a dataset, exported by the platform and checked.
 * Only dashboards of this dataset count: an id the dataset does not list is
 * skipped. A dashboard that fails is left out with a warning; the rest of the
 * package is shared, as with demo data.
 */
export async function collectSharedDashboards(
    accessToken: string,
    datasetId: string,
    chosen: readonly string[],
): Promise<{ dashboards: SharedDashboard[]; warnings: string[] }> {
    if (chosen.length === 0) return { dashboards: [], warnings: [] }
    const listed = await dashboardChoices(datasetId, accessToken)
    if (listed.length === 0) {
        return { dashboards: [], warnings: ['Dashboards nicht im Paket: Die Dashboards des Datensatzes ließen sich nicht lesen.'] }
    }
    const byId = new Map(listed.map((choice) => [choice.id, choice]))
    const dashboards: SharedDashboard[] = []
    const warnings: string[] = []
    for (const id of chosen) {
        const choice = byId.get(id)
        if (!choice) {
            warnings.push('Ein gewähltes Dashboard gehört nicht mehr zu diesem Datensatz und fehlt im Paket.')
            continue
        }
        const exported = await fetchDashboardExport(accessToken, datasetId, id)
        if (!exported.ok) {
            warnings.push(`Dashboard „${choice.title}“ fehlt im Paket: ${exported.reason}.`)
            continue
        }
        const checked = checkSharedDashboard(exported.document, `Dashboard „${choice.title}“`)
        if ('refusal' in checked) {
            warnings.push(`Dashboard „${choice.title}“ fehlt im Paket: ${checked.refusal}.`)
            continue
        }
        dashboards.push(checked.dashboard)
    }
    return { dashboards, warnings }
}
