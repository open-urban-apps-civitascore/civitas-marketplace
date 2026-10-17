import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { createZip, readZip } from '@/lib/superset/zip'

/**
 * The package form of a Superset dashboard, and the two conversions around it.
 *
 * Superset exports a dashboard as a ZIP of YAML files under one root folder
 * (`dashboard_export_<timestamp>/metadata.yaml`, `dashboards/…`, `charts/…`,
 * `datasets/…`, `databases/…`). A package member has to be a JSON document,
 * because the catalogue reads every member as JSON, and it should stay
 * readable in a diff. So the package keeps the export as ONE JSON document:
 * every file's path without the root folder, mapped to its YAML document
 * parsed into JSON.
 *
 * The import goes the other way: YAML again, and a root folder again. Superset
 * drops the first path segment of every file in an uploaded bundle, so a file
 * at the top level of the ZIP would lose its name, and the import would not
 * find metadata.yaml.
 */

export interface SupersetDashboardDocument {
    tool: 'superset'
    /** The Superset version the export came from. Information for the reader; the import does not check it. */
    supersetVersion?: string
    /** One entry per exported file: path without the root folder, mapped to the parsed YAML document. */
    files: Record<string, Record<string, unknown>>
}

export class DashboardDocumentError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'DashboardDocumentError'
    }
}

/** Any name works: Superset only needs the files to sit one folder deep. */
const IMPORT_ROOT_FOLDER = 'dashboard_export'

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Checks a member document before anything is sent to Superset. One dashboard
 * per document: the install reports one link per member, and a bulk export of
 * several dashboards would leave it unclear which one the use case means.
 */
export function readDashboardDocument(value: unknown, where = 'Dashboard'): SupersetDashboardDocument {
    if (!isRecord(value)) throw new DashboardDocumentError(`${where}: not an object`)
    if (value.tool !== 'superset') {
        throw new DashboardDocumentError(`${where}: tool must be 'superset', found ${JSON.stringify(value.tool)}`)
    }
    if (!isRecord(value.files)) throw new DashboardDocumentError(`${where}: 'files' is missing`)
    for (const [path, document] of Object.entries(value.files)) {
        if (!isRecord(document)) throw new DashboardDocumentError(`${where}: '${path}' is not an object`)
    }
    const metadata = value.files['metadata.yaml']
    if (!isRecord(metadata) || metadata.type !== 'Dashboard') {
        throw new DashboardDocumentError(`${where}: metadata.yaml does not describe a dashboard export`)
    }
    const dashboards = Object.keys(value.files).filter((path) => path.startsWith('dashboards/'))
    if (dashboards.length !== 1) {
        throw new DashboardDocumentError(`${where}: exactly one dashboard expected, found ${dashboards.length}`)
    }
    return value as unknown as SupersetDashboardDocument
}

/** A Superset export ZIP in package form. Used by scripts/superset-export-to-member.ts. */
export function documentFromExport(zip: Buffer, supersetVersion?: string): SupersetDashboardDocument {
    const files: Record<string, Record<string, unknown>> = {}
    for (const [path, data] of Object.entries(readZip(zip))) {
        if (path.endsWith('/')) continue
        const separator = path.indexOf('/')
        if (separator < 0) {
            throw new DashboardDocumentError(`'${path}' is not inside the export's root folder`)
        }
        const relative = path.slice(separator + 1)
        if (!/\.ya?ml$/.test(relative)) {
            throw new DashboardDocumentError(`'${relative}' is not a YAML file; a dashboard export holds nothing else`)
        }
        const document: unknown = parseYaml(data.toString('utf-8'))
        if (!isRecord(document)) throw new DashboardDocumentError(`'${relative}' is not a YAML mapping`)
        files[relative] = document
    }
    return readDashboardDocument({
        tool: 'superset',
        ...(supersetVersion ? { supersetVersion } : {}),
        files,
    })
}

/**
 * The upload Superset's import endpoint reads. YAML 1.1 on the way out,
 * because Superset reads with PyYAML (YAML 1.1): there an unquoted `yes` or
 * `on` is a boolean, so a string with that value has to be quoted.
 */
export function importZip(files: Record<string, Record<string, unknown>>): Buffer {
    return createZip(
        Object.fromEntries(
            Object.entries(files).map(([path, document]) => [
                `${IMPORT_ROOT_FOLDER}/${path}`,
                stringifyYaml(document, { version: '1.1', lineWidth: 0 }),
            ]),
        ),
    )
}
