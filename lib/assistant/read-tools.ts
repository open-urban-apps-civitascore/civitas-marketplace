import { resolveCatalogEntry } from '@/lib/catalog/source'
import { isDataStructureEntry, type CatalogEntry } from '@/lib/catalog/types'
import { fetchDatasetOverview } from '@/lib/datapool-of-dataset'
import { fetchDatapools } from '@/lib/datapools'
import { partitionInstallations, readAllInstallations } from '@/lib/installation-list'
import type { InstallationReceipt } from '@/lib/install-payload'
import { getAccessToken } from '@/lib/session'

/**
 * What the assistant may look up before it answers: catalogue content, and
 * what this instance holds. Every read goes out with the signed-in user's
 * token, so the assistant sees exactly what the person may see. Each tool
 * answers in short text the model reads; a failed read is a sentence, not an
 * exception.
 */

/** A read tool: its JSON Schema for the model, and what it answers. */
export interface ReadTool {
    name: string
    description: string
    input_schema: Record<string, unknown>
    run: (input: unknown) => Promise<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The objects of a JSON-Schema structure with their fields, one line each. */
function structureFields(model: Record<string, unknown>): string {
    const objects: [string, unknown][] = isRecord(model.$defs) ? Object.entries(model.$defs) : []
    if (isRecord(model.properties)) objects.unshift(['(Wurzel)', model])
    return objects
        .map(([name, node]) => {
            if (!isRecord(node) || !isRecord(node.properties)) return `${name}: (keine Felder)`
            const required = Array.isArray(node.required) ? node.required.map(String) : []
            const fields = Object.entries(node.properties).map(([field, schema]) => {
                const s = isRecord(schema) ? schema : {}
                const type = typeof s.type === 'string' ? s.type : typeof s.$ref === 'string' ? `ref ${s.$ref}` : '?'
                const format = typeof s.format === 'string' ? `/${s.format}` : ''
                return `${field} (${type}${format}${required.includes(field) ? ', Pflicht' : ''})`
            })
            return `${name}: ${fields.join(', ')}`
        })
        .join('\n    ')
}

function compact(value: unknown, max = 600): string {
    const text = JSON.stringify(value)
    return text.length > max ? `${text.slice(0, max)} …` : text
}

function describeEntry(entry: CatalogEntry): string {
    const head = `${entry.manifest.type === 'usecase' ? 'Use Case' : 'Datenstruktur'} „${entry.manifest.displayName}“ v${entry.manifest.version} (${entry.manifest.maintainer}): ${entry.manifest.description}`
    if (isDataStructureEntry(entry)) return `${head}\nFelder:\n    ${structureFields(entry.artifact)}`

    const { bundle } = entry
    const lines = [head]
    lines.push(
        'Datenstrukturen:',
        ...bundle.dataStructures.map((structure) => `  - „${structure.name}“\n    ${structureFields(structure.model)}`),
    )
    if (bundle.dataSources.length) {
        lines.push(
            'Datenquellen:',
            ...bundle.dataSources.map(({ document }) => {
                const where = Array.isArray(document.topics)
                    ? `Topics ${document.topics.join(', ')}`
                    : typeof document.table === 'string'
                      ? `Tabelle ${document.table}`
                      : ''
                return `  - „${String(document.title)}“: ${String(document.connectionType)} ${where}`
            }),
        )
    }
    if (bundle.mappings.length) {
        lines.push(
            'Mappings:',
            ...bundle.mappings.map((mapping) => `  - „${mapping.name}“: ${compact(isRecord(mapping.document) ? mapping.document.fields : undefined)}`),
        )
    }
    if (bundle.dataSinks.length) {
        lines.push(
            'Datensenken:',
            ...bundle.dataSinks.map(({ document }) => `  - „${String(document.title)}“: ${String(document.connectionType)}${typeof document.tableName === 'string' ? `, Tabelle ${document.tableName}` : ''}`),
        )
    }
    if (bundle.pipelines.length) lines.push(`Pipelines: ${bundle.pipelines.map((pipeline) => `„${pipeline.name}“`).join(', ')}`)
    for (const simulation of bundle.simulations) {
        const streams = 'streams' in simulation && Array.isArray(simulation.streams) ? simulation.streams : []
        lines.push(
            `Demodaten für „${simulation.sourceRef}“: ${streams.length} Strom/Ströme${'intervalSeconds' in simulation ? `, alle ${String(simulation.intervalSeconds)} s` : ''}`,
            ...(streams[0] ? [`  Beispiel-Strom „${streams[0].name}“: ${compact(streams[0].fields)}`] : []),
        )
    }
    if (bundle.dashboards?.length) lines.push(`Dashboards: ${bundle.dashboards.length}`)
    if (bundle.apis?.length) lines.push(`APIs: ${bundle.apis.map((api) => String(api.document.slug)).join(', ')}`)
    if (bundle.layers?.length) lines.push(`Kartenebenen: ${bundle.layers.map((layer) => String(layer.document.layerName)).join(', ')}`)
    return lines.join('\n')
}

/** Rows of a paged portal list, reduced to name, status and description. */
async function readPortalList(path: string, what: string): Promise<string> {
    const response = await fetch(`${process.env.API_BASE_URL}:${process.env.API_PORT}${path}`, {
        headers: { Authorization: `Bearer ${await getAccessToken()}` },
        cache: 'no-store',
    })
    if (!response.ok) return `${what} nicht lesbar: ${response.status} ${response.statusText}`
    const body = (await response.json()) as { content?: unknown[] } | unknown[]
    const rows = Array.isArray(body) ? body : (body.content ?? [])
    if (rows.length === 0) return `Keine ${what} sichtbar.`
    return rows
        .filter(isRecord)
        .map((row) => {
            const status = Object.entries(row).find(([key, value]) => /status/i.test(key) && typeof value === 'string')
            const description = typeof row.description === 'string' ? `: ${row.description}` : ''
            return `- „${String(row.name ?? row.title ?? row.id)}“${status ? ` [${String(status[1])}]` : ''}${description}`
        })
        .join('\n')
}

type InstallationRow = InstallationReceipt & { installedAt?: string; uninstalledAt?: string | null }

export const READ_TOOLS: ReadTool[] = [
    {
        name: 'katalog_eintrag_lesen',
        description:
            'Liest den Inhalt eines Katalog-Eintrags: Datenstrukturen mit Feldern, Datenquellen, Mappings, Senken, Pipelines und Demodaten. Nutze die Kennung aus der Katalogliste. Für genaue Erklärungen eines Eintrags und um einen eigenen Anwendungsfall nach seinem Vorbild zu bauen.',
        input_schema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'Kennung des Eintrags aus der Katalogliste.' } },
            required: ['id'],
        },
        run: async (input) => {
            const id = isRecord(input) ? input.id : undefined
            if (typeof id !== 'string' || !id) return 'Keine Kennung angegeben.'
            const entry = await resolveCatalogEntry(id)
            return entry ? describeEntry(entry) : `Kein Katalog-Eintrag mit der Kennung ${id}.`
        },
    },
    {
        name: 'installationen_auflisten',
        description: 'Listet, was in dieser Instanz aus dem Marketplace installiert ist (aktiv und früher), mit Datensatz und angelegten Bausteinen.',
        input_schema: { type: 'object', properties: {} },
        run: async () => {
            const accessToken = await getAccessToken()
            const list = await readAllInstallations<InstallationRow>(accessToken)
            if (!list.ok) return `Installationen nicht lesbar: ${list.status} ${list.statusText}`
            const { active, history } = partitionInstallations(list.rows)
            if (active.length === 0) return `Nichts installiert. Früher deinstalliert: ${history.length}.`
            // The pool and status live on the dataset, not on the installation record.
            const overviews = await Promise.all(
                active.map((row) => (row.dataSetId ? fetchDatasetOverview(row.dataSetId, accessToken) : null)),
            )
            const lines = active.map((row, index) => {
                const kinds = new Map<string, number>()
                for (const line of row.artifacts ?? []) {
                    const kind = line.artifactType ?? '?'
                    kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
                }
                const made = [...kinds].map(([kind, count]) => `${count}× ${kind}`).join(', ')
                const overview = overviews[index]
                const pool = overview?.datapool ? `, Datenpool „${overview.datapool.name}“` : ''
                const status = overview?.status ? `, Status ${overview.status}` : ''
                const origin = row.packageId?.startsWith('urn:openurbanapps:usecase:assistent-') ? ' [vom Assistenten erzeugt]' : ''
                return `- Paket ${row.packageId ?? '?'} v${row.packageVersion ?? '?'}${origin}: Datensatz „${row.dataSetName ?? '–'}“${pool}${status}${row.installedAt ? `, installiert ${row.installedAt}` : ''}${made ? ` (${made})` : ''}`
            })
            return [`Aktiv (${active.length}):`, ...lines, `Früher deinstalliert: ${history.length}.`].join('\n')
        },
    },
    {
        name: 'datenpools_auflisten',
        description: 'Listet die Datenpools dieser Instanz, die die angemeldete Person sieht.',
        input_schema: { type: 'object', properties: {} },
        run: async () => {
            const listing = await fetchDatapools()
            if (listing.problem) return `Datenpools nicht vollständig lesbar: ${listing.problem}`
            if (listing.pools.length === 0) return 'Keine Datenpools sichtbar.'
            return listing.pools.map((pool) => `- „${pool.name}“${pool.description ? `: ${pool.description}` : ''}`).join('\n')
        },
    },
    {
        name: 'datensaetze_auflisten',
        description: 'Listet die Datensätze dieser Instanz mit Status (Entwurf, freigegeben …), auch die von Hand angelegten.',
        input_schema: { type: 'object', properties: {} },
        run: () => readPortalList('/v1/datasets?size=200', 'Datensätze'),
    },
    {
        name: 'datenstrukturen_der_instanz',
        description: 'Listet die Datenstrukturen, die es in dieser Instanz schon gibt, auch die von Hand angelegten. Nützlich, bevor eine neue vorgeschlagen wird.',
        input_schema: { type: 'object', properties: {} },
        run: () => readPortalList('/v1/datastructures?size=200', 'Datenstrukturen'),
    },
]
