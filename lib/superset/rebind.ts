import { createHash } from 'node:crypto'

import type { SupersetDashboardDocument } from '@/lib/superset/bundle'

/**
 * Makes a packaged dashboard belong to ONE installation before it is imported.
 *
 * Superset identifies every object of an import by its UUID, and an import
 * with overwrite replaces whatever already carries that UUID. A package
 * imported as exported would therefore point the dashboard of the first
 * installation at the data of the second. So the dashboard, its charts and
 * its datasets get UUIDs of their own per installation, and every reference
 * between them follows (`dataset_uuid`, the chart entries of the layout, the
 * targets of native filters).
 *
 * The database connection is the opposite case. It belongs to the instance,
 * not to the package: the bundle's database file takes the UUID of the
 * instance's existing connection, and Superset then reuses that connection
 * instead of creating one from the package. The package never brings an
 * address or a password.
 */

export interface InstallationBinding {
    installationId: string
    /** The platform dataset whose data storage the dashboard reads (its schema: `datasetSchema`). */
    datasetId: string
    /** UUID of the instance's Superset connection to the platform's data storage. */
    databaseUuid: string
    /** Markdown for a text tile across the top of the dashboard, if any. */
    notice?: string
}

/** Where a packaged dashboard lives in one installation. */
export interface InstalledDashboardIdentity {
    /** The dashboard's UUID in this installation, to find it again on uninstall. */
    uuid: string
    title?: string
    /** Unique per installation, like the UUID: the slug is a dashboard's second unique key. */
    slug: string
}

export interface BoundDashboard extends InstalledDashboardIdentity {
    files: Record<string, Record<string, unknown>>
}

export class DashboardBindingError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'DashboardBindingError'
    }
}

/**
 * The UUID an object of the package gets in one installation.
 *
 * Derived, not random: the same installation always gets the same UUID for
 * the same object, so a retried import replaces what the first attempt
 * created instead of adding a second dashboard. Different installations, and
 * different objects of one installation, get different UUIDs.
 *
 * Built like a version 5 UUID (RFC 9562): SHA-1 over both inputs, the first
 * 16 bytes, with the version and variant bits set so that the result is a
 * standard UUID and not only something shaped like one.
 */
export function deriveInstallUuid(installationId: string, originalUuid: string): string {
    const bytes = createHash('sha1').update(`${installationId}:${originalUuid}`).digest().subarray(0, 16)
    bytes[6] = (bytes[6] & 0x0f) | 0x50 // version 5: derived from a name by SHA-1
    bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant: the RFC 9562 layout
    const hex = bytes.toString('hex')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * The PostGIS schema the platform's sink writes a dataset into. Follows the
 * platform's rule in `WorkspaceNames.fromDatasetId` (config-adapter-api),
 * which also names the dataset's GeoServer workspace: lowercased, every
 * character other than a-z, 0-9 and _ replaced by _, and `ds_` in front only
 * when the result starts with a digit, because a workspace name must not.
 */
export function datasetSchema(datasetId: string): string {
    const normalized = datasetId.toLowerCase().replace(/[^a-z0-9_]/g, '_')
    return /^[0-9]/.test(normalized) ? `ds_${normalized}` : normalized
}

/** The accents NFKD splits off a letter (U+0300 to U+036F), built without escape sequences in the source. */
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g')

/** A URL slug from a title: German umlauts spelled out, everything else reduced to a-z, 0-9 and dashes. */
function slugFromTitle(title: string): string {
    return title
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .normalize('NFKD')
        .replace(COMBINING_MARKS, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

function slugSuffix(installationId: string): string {
    return installationId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()
}

/**
 * Where a packaged dashboard lives in one installation: its UUID, title and
 * slug there. The import writes exactly these, so a page can link to an
 * installed dashboard without asking Superset and without keeping a record.
 */
export function installedDashboardIdentity(
    document: SupersetDashboardDocument,
    installationId: string,
): InstalledDashboardIdentity {
    const entry = Object.entries(document.files).find(([path]) => path.startsWith('dashboards/'))
    if (!entry) throw new DashboardBindingError('the document holds no dashboard')
    const [path, dashboard] = entry
    if (typeof dashboard.uuid !== 'string' || !dashboard.uuid) {
        throw new DashboardBindingError(`'${path}' has no uuid`)
    }
    const title = typeof dashboard.dashboard_title === 'string' ? dashboard.dashboard_title : undefined
    // An export without a slug gets one from its title, so a link can always
    // name the dashboard itself.
    const base = (typeof dashboard.slug === 'string' && dashboard.slug) || slugFromTitle(title ?? '') || 'dashboard'
    return {
        uuid: deriveInstallUuid(installationId, dashboard.uuid),
        title,
        slug: `${base}-${slugSuffix(installationId)}`,
    }
}

/** Ids of the notice tile. Fixed, so a retried import replaces the tile instead of adding a second. */
const NOTICE_ROW = 'ROW-marketplace-notice'
const NOTICE_MARKDOWN = 'MARKDOWN-marketplace-notice'

/**
 * The dashboard layout with a text tile across its full width on top.
 * Superset keeps a layout as a tree under GRID_ID; the tile is a MARKDOWN
 * element in a ROW of its own, placed first (12 columns wide, height in
 * 8 px grid units). A layout without a grid is left as it is.
 */
function withNotice(position: unknown, notice: string): unknown {
    if (!isRecord(position) || !isRecord(position.GRID_ID)) return position
    const grid = position.GRID_ID
    const rows = Array.isArray(grid.children) ? grid.children.filter((id) => id !== NOTICE_ROW) : []
    return {
        ...position,
        GRID_ID: { ...grid, children: [NOTICE_ROW, ...rows] },
        [NOTICE_ROW]: {
            type: 'ROW',
            id: NOTICE_ROW,
            children: [NOTICE_MARKDOWN],
            parents: ['ROOT_ID', 'GRID_ID'],
            meta: { background: 'BACKGROUND_TRANSPARENT' },
        },
        [NOTICE_MARKDOWN]: {
            type: 'MARKDOWN',
            id: NOTICE_MARKDOWN,
            children: [],
            parents: ['ROOT_ID', 'GRID_ID', NOTICE_ROW],
            meta: { width: 12, height: 16, code: notice },
        },
    }
}

/** Folders of the objects that belong to the package and get new UUIDs per installation. */
const OWNED_FOLDERS = ['dashboards/', 'charts/', 'datasets/']

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Replaces every string, and every object key, that equals a mapped UUID. Returns a copy. */
function replaceUuids(value: unknown, replacements: Map<string, string>): unknown {
    if (typeof value === 'string') return replacements.get(value) ?? value
    if (Array.isArray(value)) return value.map((item) => replaceUuids(item, replacements))
    if (isRecord(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [replacements.get(key) ?? key, replaceUuids(item, replacements)]),
        )
    }
    return value
}

export function bindToInstallation(
    document: SupersetDashboardDocument,
    binding: InstallationBinding,
): BoundDashboard {
    const replacements = new Map<string, string>()
    const databaseFiles = Object.keys(document.files).filter((path) => path.startsWith('databases/'))
    if (databaseFiles.length > 1) {
        throw new DashboardBindingError(
            `the dashboard reads ${databaseFiles.length} databases; a use case dashboard reads only the platform's data storage`,
        )
    }
    for (const [path, file] of Object.entries(document.files)) {
        const owned = OWNED_FOLDERS.some((folder) => path.startsWith(folder))
        if (!owned && !path.startsWith('databases/')) continue
        if (typeof file.uuid !== 'string' || !file.uuid) {
            throw new DashboardBindingError(`'${path}' has no uuid`)
        }
        replacements.set(
            file.uuid,
            owned ? deriveInstallUuid(binding.installationId, file.uuid) : binding.databaseUuid,
        )
    }

    const schema = datasetSchema(binding.datasetId)
    const identity = installedDashboardIdentity(document, binding.installationId)
    const files: Record<string, Record<string, unknown>> = {}

    for (const [path, file] of Object.entries(document.files)) {
        const copy = replaceUuids(file, replacements) as Record<string, unknown>
        if (path.startsWith('datasets/')) {
            if (typeof copy.sql === 'string' && copy.sql.trim()) {
                throw new DashboardBindingError(
                    `'${path}' is a SQL dataset; only a table dataset can follow the installation's schema`,
                )
            }
            copy.schema = schema
            // Superset 6 records the exporting instance's database name as the
            // catalog. Left empty, it takes the database of the connection, which
            // may be named differently on the receiving instance.
            copy.catalog = null
        }
        if (path.startsWith('dashboards/')) {
            copy.slug = identity.slug
            if (binding.notice) copy.position = withNotice(copy.position, binding.notice)
        }
        files[path] = copy
    }

    return { files, ...identity }
}
