/**
 * A use case's Masterportal entries, applied to the three config files of the geoportal add-on:
 * `service.json` (the layer services), `config.json` (the layer tree) and `style_v3.json` (the
 * vector styles), and taken out of them again. Pure, so the rules can be tested without files.
 *
 * The package names each layer's API by its slug only. Identity and address belong to the
 * receiving instance and are written here: the id is `<datasetId>-<slug>`, the url points at the
 * dataset's named API behind `${GEOSERVER_URL}`, which the geoportal backend replaces with its own
 * base. Every rule replaces what this use case wrote before and keeps everything else, so applying
 * twice is the same as applying once, and the operator's own entries survive. The id prefix is
 * what makes an entry this use case's: for the apply, for the way back (extract.ts) and for the
 * removal at uninstall.
 */

export class MasterportalMemberError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'MasterportalMemberError'
    }
}

export interface PortalLayer {
    /** Slug of the dataset's named API that serves the layer. */
    apiRef: string
    visibility: boolean
    /** Masterportal service fields, without id, url and groups. */
    service: Record<string, unknown>
}

export interface MasterportalMember {
    folder: string
    layers: PortalLayer[]
    styles: Record<string, unknown>[]
}

export interface GeoportalFiles {
    services: unknown
    config: unknown
    styles: unknown
}

export interface AppliedGeoportal {
    services: unknown[]
    config: Record<string, unknown>
    styles: unknown[]
    /** The portal copies its styles at start only, so a change needs a restart to show. */
    stylesChanged: boolean
}

/** The three files without one dataset's entries, and what went. */
export interface RemovedGeoportal {
    services: unknown[]
    config: Record<string, unknown>
    styles: unknown[]
    removed: {
        /** Ids of the services that went. */
        services: string[]
        /** Folders that held nothing but this dataset's layers. */
        folders: number
        /** Styles the services named that no remaining service names. */
        styles: string[]
    }
    /** Whether anything went: the files need writing only then. */
    changed: boolean
}

/**
 * The groups a layer is listed for. Fixed to the public group for now: whether a dataset is
 * public is the operator's Open Data switch, which this does not read yet.
 */
const PUBLIC_GROUPS = ['open_data']

/** Fields of a service that belong to the instance, never to a package. */
export const INSTANCE_FIELDS: readonly string[] = ['id', 'url', 'groups']

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The member document, checked: the package validator's rules, for a package that skipped it. */
export function readMasterportalMember(document: Record<string, unknown>, where: string): MasterportalMember {
    const folder = document.folder
    if (typeof folder !== 'string' || !folder.trim()) {
        throw new MasterportalMemberError(`${where}: masterportal needs a folder name`)
    }
    if (!Array.isArray(document.layers) || document.layers.length === 0) {
        throw new MasterportalMemberError(`${where}: masterportal needs at least one layer`)
    }
    const layers = document.layers.map((layer: unknown, index): PortalLayer => {
        if (!isRecord(layer) || typeof layer.apiRef !== 'string' || !layer.apiRef || !isRecord(layer.service)) {
            throw new MasterportalMemberError(`${where}: layers[${index}] needs an apiRef and a service`)
        }
        const carried = INSTANCE_FIELDS.filter((field) => field in (layer.service as Record<string, unknown>))
        if (carried.length > 0) {
            throw new MasterportalMemberError(
                `${where}: layers[${index}] carries ${carried.join(', ')}, which belong to the instance`,
            )
        }
        return { apiRef: layer.apiRef, visibility: layer.visibility === true, service: layer.service }
    })
    const styles = document.styles ?? []
    if (!Array.isArray(styles) || !styles.every((style) => isRecord(style) && typeof style.styleId === 'string')) {
        throw new MasterportalMemberError(`${where}: masterportal styles must be a list of styles with a styleId`)
    }
    return { folder, layers, styles }
}

/** The id a layer of this dataset gets in the portal. Unique per installation. */
export function serviceId(datasetId: string, apiRef: string): string {
    return `${ownPrefix(datasetId)}${apiRef}`
}

/** The start of every id this dataset's entries carry, and so what makes an entry its own. */
export function ownPrefix(datasetId: string): string {
    return `${datasetId}-`
}

function isOwnEntry(element: unknown, prefix: string): boolean {
    return isRecord(element) && typeof element.id === 'string' && element.id.startsWith(prefix)
}

/** The service entries of the member, with the identity and address of this instance's dataset. */
export function portalServices(member: MasterportalMember, datasetId: string): Record<string, unknown>[] {
    return member.layers.map((layer) => ({
        id: serviceId(datasetId, layer.apiRef),
        ...layer.service,
        url: `\${GEOSERVER_URL}/${datasetId}/${layer.apiRef}`,
        groups: [...PUBLIC_GROUPS],
    }))
}

function serviceList(services: unknown): unknown[] {
    if (!Array.isArray(services)) {
        throw new MasterportalMemberError('service.json is not a list of services')
    }
    return services
}

function styleList(styles: unknown): unknown[] {
    if (!Array.isArray(styles)) {
        throw new MasterportalMemberError('style_v3.json is not a list of styles')
    }
    return styles
}

/** The service list without this dataset's entries, then the new ones. */
export function mergeServices(services: unknown, datasetId: string, entries: Record<string, unknown>[]): unknown[] {
    const prefix = ownPrefix(datasetId)
    return [...serviceList(services).filter((service) => !isOwnEntry(service, prefix)), ...entries]
}

type Folder = Record<string, unknown> & { elements: unknown[] }

function isFolder(element: unknown): element is Folder {
    return isRecord(element) && element.type === 'folder' && Array.isArray(element.elements)
}

/**
 * Whether a folder holds layers of this dataset. A folder has no id in the Masterportal config, so
 * its layers say whose it is. Its name would not: two installations can bring folders of the same
 * name, and an operator may rename one.
 */
function holdsOwnEntries(element: unknown, prefix: string): element is Folder {
    return isFolder(element) && element.elements.some((child) => isOwnEntry(child, prefix))
}

/** The first folder of the tree, depth first, that holds layers of this dataset. */
export function findOwnFolder(elements: unknown[], prefix: string): Folder | undefined {
    for (const element of elements) {
        if (holdsOwnEntries(element, prefix)) return element
        if (isFolder(element)) {
            const inner = findOwnFolder(element.elements, prefix)
            if (inner) return inner
        }
    }
    return undefined
}

/** The tree with that folder replaced where it stands, or undefined when the tree has none. */
function replaceOwnFolder(elements: unknown[], prefix: string, folder: Folder): unknown[] | undefined {
    for (const [index, element] of elements.entries()) {
        let replacement: unknown
        if (holdsOwnEntries(element, prefix)) {
            replacement = folder
        } else if (isFolder(element)) {
            const inner = replaceOwnFolder(element.elements, prefix, folder)
            if (inner) replacement = { ...element, elements: inner }
        }
        if (replacement) return elements.map((other, position) => (position === index ? replacement : other))
    }
    return undefined
}

/**
 * The tree without this dataset's layers. A folder that held nothing else goes with them, and is
 * counted; a folder that holds anything else stays with the rest, and so does a folder that was
 * empty before.
 */
function withoutOwnEntries(elements: unknown[], prefix: string): { elements: unknown[]; folders: number; changed: boolean } {
    const kept: unknown[] = []
    let folders = 0
    let changed = false
    for (const element of elements) {
        if (isOwnEntry(element, prefix)) {
            changed = true
            continue
        }
        if (!isFolder(element)) {
            kept.push(element)
            continue
        }
        const inner = withoutOwnEntries(element.elements, prefix)
        folders += inner.folders
        if (!inner.changed) {
            kept.push(element)
            continue
        }
        changed = true
        if (inner.elements.length === 0) folders += 1
        else kept.push({ ...element, elements: inner.elements })
    }
    return { elements: kept, folders, changed }
}

export interface LayerTree {
    /** The subject layers: folders and layer entries, the part of the tree the use cases go into. */
    elements: unknown[]
    /** The config with other subject layers, everything else as it was. */
    with: (elements: unknown[]) => Record<string, unknown>
}

export function layerTree(config: unknown): LayerTree {
    if (!isRecord(config)) {
        throw new MasterportalMemberError('config.json is not an object')
    }
    const layerConfig = isRecord(config.layerConfig) ? config.layerConfig : {}
    const subjectlayer = isRecord(layerConfig.subjectlayer) ? layerConfig.subjectlayer : {}
    return {
        elements: Array.isArray(subjectlayer.elements) ? subjectlayer.elements : [],
        with: (elements) => ({ ...config, layerConfig: { ...layerConfig, subjectlayer: { ...subjectlayer, elements } } }),
    }
}

/**
 * The layer tree with the use case's folder. The folder that holds this dataset's layers is
 * replaced where it stands, so a folder the operator moved stays where they put it. Without one,
 * the new folder goes first: the use case the operator just installed is the first thing in the
 * tree.
 */
export function mergeFolder(config: unknown, member: MasterportalMember, datasetId: string): Record<string, unknown> {
    const tree = layerTree(config)
    const folder: Folder = {
        name: member.folder,
        type: 'folder',
        elements: member.layers.map((layer) => ({
            id: serviceId(datasetId, layer.apiRef),
            visibility: layer.visibility,
        })),
    }
    return tree.with(replaceOwnFolder(tree.elements, ownPrefix(datasetId), folder) ?? [folder, ...tree.elements])
}

/** The style list with the member's styles: same styleId replaced where it stands, new ones appended. */
export function mergeStyles(styles: unknown, entries: Record<string, unknown>[]): unknown[] {
    const merged = [...styleList(styles)]
    for (const entry of entries) {
        const index = merged.findIndex((style) => isRecord(style) && style.styleId === entry.styleId)
        if (index >= 0) merged[index] = entry
        else merged.push(entry)
    }
    return merged
}

/** All three files with the member applied for one dataset. */
export function applyMasterportal(files: GeoportalFiles, member: MasterportalMember, datasetId: string): AppliedGeoportal {
    const styles = mergeStyles(files.styles, member.styles)
    return {
        services: mergeServices(files.services, datasetId, portalServices(member, datasetId)),
        config: mergeFolder(files.config, member, datasetId),
        styles,
        stylesChanged: JSON.stringify(styles) !== JSON.stringify(files.styles),
    }
}

function styleIdsOf(services: unknown[]): Set<string> {
    return new Set(services.flatMap((service) => (isRecord(service) && typeof service.styleId === 'string' ? [service.styleId] : [])))
}

/**
 * All three files without one dataset's entries: its services, its layers in the tree together
 * with the folders that held only them, and the styles its services named. A style has no owner
 * of its own, so it stays while any other service names it: another installation of a package
 * with the same style, or an entry of the operator.
 */
export function removeMasterportal(files: GeoportalFiles, datasetId: string): RemovedGeoportal {
    const prefix = ownPrefix(datasetId)
    const services = serviceList(files.services)
    const styles = styleList(files.styles)
    const tree = layerTree(files.config)

    const own = services.filter((service) => isOwnEntry(service, prefix))
    const others = services.filter((service) => !isOwnEntry(service, prefix))
    const stillNamed = styleIdsOf(others)
    const orphaned = new Set([...styleIdsOf(own)].filter((styleId) => !stillNamed.has(styleId)))
    const isOrphaned = (style: unknown) => isRecord(style) && typeof style.styleId === 'string' && orphaned.has(style.styleId)
    const removedStyles = styles.filter(isOrphaned).map((style) => (style as { styleId: string }).styleId)
    const pruned = withoutOwnEntries(tree.elements, prefix)

    return {
        services: others,
        config: pruned.changed ? tree.with(pruned.elements) : (files.config as Record<string, unknown>),
        styles: styles.filter((style) => !isOrphaned(style)),
        removed: {
            services: own.map((service) => (service as { id: string }).id),
            folders: pruned.folders,
            styles: removedStyles,
        },
        changed: own.length > 0 || pruned.changed || removedStyles.length > 0,
    }
}
