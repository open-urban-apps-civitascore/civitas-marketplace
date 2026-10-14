import { resolveCatalogEntry } from '@/lib/catalog/source'
import { isDataStructureEntry, isSqlSimulation, type CatalogSummary, type UseCaseEntry } from '@/lib/catalog/types'
import { ARTIFACT_KINDS } from '@/lib/ui/artifact-kinds'

/**
 * What a package brings, read from the package itself: the catalogue index
 * names an entry, only the package says what it consists of. For the detail
 * page (does it come with demo data, which interfaces, which parts) and the
 * install dialog's "das wird angelegt".
 *
 * Kept per pin: a pin is a commit, so the content behind it never changes and
 * one read per version and server process is enough. A failed read is not
 * kept, so the next view tries again.
 */

type PartType = keyof typeof ARTIFACT_KINDS | 'dashboard'

export interface PackagePart {
    type: PartType
    /** German name of the kind, singular or plural to match `names`. */
    label: string
    /** The kind in the singular, for a row that names one of them. */
    one: string
    names: string[]
}

export interface PackageApi {
    name: string
    /** `OWS` for maps, `STA` for SensorThings, `CUSTOM`. */
    standard: string
    description?: string
}

export interface PackageContents {
    /** The parts in the order the data passes them, kinds present only. */
    parts: PackagePart[]
    apis: PackageApi[]
    /** The demo streams the package ships, as a person reads them; empty without demo data. */
    demoStreams: string[]
}

const DASHBOARD = { one: 'Dashboard', many: 'Dashboards', order: 99 }

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

/** The summary of an assembled package. Pure, so it can be tested without a network. */
export function summarisePackage(entry: UseCaseEntry): PackageContents {
    const { bundle } = entry
    const named: { type: PartType; names: string[] }[] = [
        { type: 'source', names: bundle.dataSources.map((source) => text(source.document.title) ?? 'Datenquelle') },
        { type: 'mapping', names: bundle.mappings.map((mapping) => mapping.name) },
        { type: 'structure', names: bundle.dataStructures.map((structure) => structure.name) },
        { type: 'pipeline', names: bundle.pipelines.map((pipeline) => pipeline.name) },
        { type: 'sink', names: bundle.dataSinks.map((sink) => text(sink.document.title) ?? 'Datensenke') },
        { type: 'api', names: (bundle.apis ?? []).map((api) => text(api.document.name) ?? 'API') },
        { type: 'layer', names: (bundle.layers ?? []).map((layer) => text(layer.document.title) ?? text(layer.document.layerName) ?? 'Kartenebene') },
        { type: 'style', names: (bundle.styles ?? []).map((style) => text(style.document.name) ?? 'Stil') },
        { type: 'dashboard', names: (bundle.dashboards ?? []).map((dashboard) => dashboardTitle(dashboard.content)) },
    ]
    const order = (type: PartType) => (type === 'dashboard' ? DASHBOARD.order : ARTIFACT_KINDS[type].order)
    const parts = named
        .filter((part) => part.names.length > 0)
        .sort((a, b) => order(a.type) - order(b.type))
        .map((part) => {
            const kind = part.type === 'dashboard' ? DASHBOARD : ARTIFACT_KINDS[part.type]
            return { ...part, label: part.names.length === 1 ? kind.one : kind.many, one: kind.one }
        })

    return {
        parts,
        apis: (bundle.apis ?? []).map((api) => ({
            name: text(api.document.name) ?? 'API',
            standard: text(api.document.standard) ?? 'CUSTOM',
            description: text(api.document.description),
        })),
        demoStreams: bundle.simulations.flatMap((simulation) =>
            isSqlSimulation(simulation)
                ? [simulation.label ?? simulation.sourceRef]
                : simulation.streams.map((stream) => stream.label ?? stream.name),
        ),
    }
}

/** A dashboard member's own title, from the one dashboard file of its export. */
function dashboardTitle(content: Record<string, unknown>): string {
    const files = content.files
    if (typeof files === 'object' && files !== null) {
        for (const [path, file] of Object.entries(files)) {
            if (path.startsWith('dashboards/') && typeof file === 'object' && file !== null) {
                const title = text((file as Record<string, unknown>).dashboard_title)
                if (title) return title
            }
        }
    }
    return 'Dashboard'
}

const cache = new Map<string, Promise<PackageContents | undefined>>()

/**
 * The contents of a pinned use case, or undefined when it has no package (a
 * described entry) or the package cannot be read right now. Never throws: the
 * detail page works without it and leaves the parts out.
 */
export function readPackageContents(summary: CatalogSummary): Promise<PackageContents | undefined> {
    const pin = summary.deploymentRef
    if (!pin) return Promise.resolve(undefined)
    const key = `${summary.id}@${summary.version}@${pin.url}@${pin.ref}@${pin.path}`
    const known = cache.get(key)
    if (known) return known

    const read = resolveCatalogEntry(summary.id)
        .then((entry) => (entry && !isDataStructureEntry(entry) ? summarisePackage(entry) : undefined))
        .catch(() => undefined)
        .then((contents) => {
            if (!contents) cache.delete(key)
            return contents
        })
    cache.set(key, read)
    return read
}
