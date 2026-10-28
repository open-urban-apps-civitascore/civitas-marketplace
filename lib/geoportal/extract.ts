import {
    INSTANCE_FIELDS,
    MasterportalMemberError,
    findOwnFolder,
    isRecord,
    layerTree,
    ownPrefix,
    readMasterportalMember,
    type GeoportalFiles,
    type MasterportalMember,
} from '@/lib/geoportal/merge'

/**
 * The way back of applyMasterportal (merge.ts): what the geoportal shows for one dataset, as the
 * package member that shows it again on another instance. Pure, like the apply.
 *
 * The dataset's entries are the ones whose id starts with `<datasetId>-`; the rest of the id is the
 * slug of the named API that serves the layer, which the member keeps as `apiRef`. What belongs to
 * this instance stays here: the id, the url and the groups. The tree gives the folder's name, the
 * order of the layers and their visibility; the styles are the ones the layers name.
 *
 * Applied and read back, a member comes out as it went in, so a change the operator made in the
 * files (a folder renamed, a layer hidden, a colour changed) is exactly what travels. What a member
 * cannot carry is said in `warnings`, in the words of the share preview: settings on a layer's tree
 * entry other than its visibility, entries of others in the folder, services outside it, styles
 * that no file holds.
 */

export interface ExtractedMember {
    member: MasterportalMember
    warnings: string[]
}

/** The keys of a tree entry the member carries: the id becomes the apiRef, the visibility stays. */
const CARRIED_TREE_KEYS = new Set(['id', 'visibility'])

/**
 * The member for one dataset, or undefined when the files hold no entry of it. Throws a
 * MasterportalMemberError for files of the wrong shape, and for entries that cannot become a
 * member: services of the dataset that no folder shows, a folder without a name.
 */
export function extractMasterportal(files: GeoportalFiles, datasetId: string): ExtractedMember | undefined {
    const serviceList = files.services
    const styleList = files.styles
    if (!Array.isArray(serviceList)) throw new MasterportalMemberError('service.json is not a list of services')
    if (!Array.isArray(styleList)) throw new MasterportalMemberError('style_v3.json is not a list of styles')

    const prefix = ownPrefix(datasetId)
    const services = new Map<string, Record<string, unknown>>()
    for (const service of serviceList) {
        if (isRecord(service) && typeof service.id === 'string' && service.id.startsWith(prefix)) {
            services.set(service.id, service)
        }
    }
    const folder = findOwnFolder(layerTree(files.config).elements, prefix)
    if (!folder) {
        if (services.size === 0) return undefined
        throw new MasterportalMemberError(`service.json holds entries of dataset ${datasetId}, but no folder of the layer tree shows them`)
    }

    const name = typeof folder.name === 'string' ? folder.name : ''
    const warnings: string[] = []
    const layers: Record<string, unknown>[] = []
    const placed = new Set<string>()
    for (const element of folder.elements) {
        const id = isRecord(element) && typeof element.id === 'string' ? element.id : undefined
        if (!id || !id.startsWith(prefix)) {
            warnings.push(
                id
                    ? `Geoportal: Die Ebene ${id} im Ordner „${name}“ gehört nicht zu diesem Datensatz und kommt nicht ins Paket.`
                    : `Geoportal: Ein Unterordner im Ordner „${name}“ kommt nicht ins Paket.`,
            )
            continue
        }
        if (placed.has(id)) continue
        const service = services.get(id)
        if (!service) {
            warnings.push(`Geoportal: Die Ebene ${id} steht im Themenbaum, aber nicht in service.json, und kommt nicht ins Paket.`)
            continue
        }
        placed.add(id)
        const entry = element as Record<string, unknown>
        const dropped = Object.keys(entry).filter((key) => !CARRIED_TREE_KEYS.has(key))
        if (dropped.length) {
            const label = typeof service.name === 'string' ? service.name : id
            warnings.push(`Geoportal: Bei der Ebene „${label}“ reisen ${dropped.join(', ')} aus dem Themenbaum nicht mit, nur die Sichtbarkeit.`)
        }
        layers.push({
            apiRef: id.slice(prefix.length),
            visibility: entry.visibility === true,
            service: Object.fromEntries(Object.entries(service).filter(([key]) => !INSTANCE_FIELDS.includes(key))),
        })
    }
    for (const id of services.keys()) {
        if (!placed.has(id)) warnings.push(`Geoportal: Der Dienst ${id} steht nicht im Ordner „${name}“ und kommt nicht ins Paket.`)
    }

    // Each style once, in the order the layers name them.
    const styleIds = [...new Set(layers.flatMap((layer) => {
        const styleId = (layer.service as Record<string, unknown>).styleId
        return typeof styleId === 'string' ? [styleId] : []
    }))]
    const styles = styleIds.flatMap((styleId) => {
        const style = styleList.find((candidate) => isRecord(candidate) && candidate.styleId === styleId)
        if (!style) warnings.push(`Geoportal: Der Stil ${styleId} fehlt in style_v3.json.`)
        return style ? [style] : []
    })

    // The member's own rules, so the way back never yields what the apply would refuse.
    return { member: readMasterportalMember({ folder: name, layers, styles }, `folder „${name}“`), warnings }
}
