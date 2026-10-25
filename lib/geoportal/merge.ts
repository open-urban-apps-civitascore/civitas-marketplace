/**
 * A use case's Masterportal entries, applied to the three config files of the geoportal add-on:
 * `service.json` (the layer services), `config.json` (the layer tree) and `style_v3.json` (the
 * vector styles). Pure, so the rules can be tested without files.
 *
 * The package names each layer's API by its slug only. Identity and address belong to the
 * receiving instance and are written here: the id is `<datasetId>-<slug>`, the url points at the
 * dataset's named API behind `${GEOSERVER_URL}`, which the geoportal backend replaces with its own
 * base. Every rule replaces what this use case wrote before and keeps everything else, so applying
 * twice is the same as applying once, and the operator's own entries survive.
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

/**
 * The groups a layer is listed for. Fixed to the public group for now: whether a dataset is
 * public is the operator's Open Data switch, which this does not read yet.
 */
const PUBLIC_GROUPS = ['open_data']

/** Fields of a service that belong to the instance, never to a package. */
const INSTANCE_FIELDS = ['id', 'url', 'groups']

function isRecord(value: unknown): value is Record<string, unknown> {
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
    return `${datasetId}-${apiRef}`
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

/** The service list without this dataset's entries, then the new ones. */
export function mergeServices(services: unknown, datasetId: string, entries: Record<string, unknown>[]): unknown[] {
    if (!Array.isArray(services)) {
        throw new MasterportalMemberError('service.json is not a list of services')
    }
    const own = `${datasetId}-`
    const others = services.filter((service) => !(isRecord(service) && typeof service.id === 'string' && service.id.startsWith(own)))
    return [...others, ...entries]
}

/**
 * The layer tree with the use case's folder: a folder of the same name is replaced where it
 * stands, a new one goes first, so the use case the operator just installed is the first thing
 * in the tree. The name identifies the folder because a package has one active installation
 * per instance.
 */
export function mergeFolder(config: unknown, member: MasterportalMember, datasetId: string): Record<string, unknown> {
    if (!isRecord(config)) {
        throw new MasterportalMemberError('config.json is not an object')
    }
    const layerConfig = isRecord(config.layerConfig) ? config.layerConfig : {}
    const subjectlayer = isRecord(layerConfig.subjectlayer) ? layerConfig.subjectlayer : {}
    const elements: unknown[] = Array.isArray(subjectlayer.elements) ? subjectlayer.elements : []

    const folder = {
        name: member.folder,
        type: 'folder',
        elements: member.layers.map((layer) => ({
            id: serviceId(datasetId, layer.apiRef),
            visibility: layer.visibility,
        })),
    }
    const index = elements.findIndex(
        (element) => isRecord(element) && element.type === 'folder' && element.name === member.folder,
    )
    const merged =
        index >= 0 ? elements.map((element, position) => (position === index ? folder : element)) : [folder, ...elements]

    return {
        ...config,
        layerConfig: { ...layerConfig, subjectlayer: { ...subjectlayer, elements: merged } },
    }
}

/** The style list with the member's styles: same styleId replaced where it stands, new ones appended. */
export function mergeStyles(styles: unknown, entries: Record<string, unknown>[]): unknown[] {
    if (!Array.isArray(styles)) {
        throw new MasterportalMemberError('style_v3.json is not a list of styles')
    }
    const merged = [...styles]
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
