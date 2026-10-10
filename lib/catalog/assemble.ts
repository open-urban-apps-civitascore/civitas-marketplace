import type {
    BundledMapping,
    BundledPipeline,
    BundledSimulation,
    CatalogEntry,
    DataStructureEntry,
    GeneratorSpec,
    PackageManifest,
    PackageMember,
    UseCaseEntry,
} from '@/lib/catalog/types'
import { isSqlSimulation } from '@/lib/catalog/types'

/**
 * Turns a package document plus its member files into a CatalogEntry — the ONE
 * assembly path for both catalogue sources: the mock fixtures hand in imported
 * JSON modules, the GitLab source hands in raw-URL fetches. Same code, same
 * checks, so the two sources cannot drift apart in install behaviour.
 *
 * Integrity failures throw {@link CatalogIntegrityError}: a package that does
 * not hang together (missing member file, identity mismatch) must never reach
 * the install path half-assembled.
 */

export class CatalogIntegrityError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'CatalogIntegrityError'
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(record: Record<string, unknown>, field: string, where: string): string {
    const value = record[field]
    if (typeof value !== 'string' || value.length === 0) {
        throw new CatalogIntegrityError(`${where}: field '${field}' is missing or not a string`)
    }
    return value
}

/** A label ends up in the simulator's name for the stream, which holds 200 characters. */
const LABEL_MAX = 80

function requireOptionalLabel(value: unknown, where: string): void {
    if (value === undefined) return
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > LABEL_MAX) {
        throw new CatalogIntegrityError(`${where}: label must be text of 1 to ${LABEL_MAX} characters`)
    }
}

function parseMembers(value: unknown, where: string): PackageMember[] {
    if (value === undefined) return []
    if (!Array.isArray(value)) {
        throw new CatalogIntegrityError(`${where} is not an array`)
    }
    return value.map((member, index) => {
        if (!isRecord(member)) {
            throw new CatalogIntegrityError(`${where}[${index}] is not an object`)
        }
        const file = requireString(member, 'file', `${where}[${index}]`)
        // Member files live flat inside core-ir/ and are embedded verbatim in
        // raw fetch URLs. URL parsers normalise dot segments (plain AND
        // percent-encoded), so a hostile name ('../…') would consume the
        // pinned-SHA URL segment and re-target the fetch at a mutable ref —
        // an allowlist is the only reliable guard.
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file)) {
            throw new CatalogIntegrityError(
                `${where}[${index}].file '${file}' is not a plain file name`,
            )
        }
        const parameters = member.parameters
        if (parameters !== undefined && !Array.isArray(parameters)) {
            throw new CatalogIntegrityError(`${where}[${index}].parameters is not an array`)
        }
        return member as unknown as PackageMember
    })
}

/**
 * Validates an untyped JSON value as a package document. Deliberately
 * structural (presence + primitive types), not schema-based — the follow-up
 * that introduces Zod as the normative schema source replaces this.
 */
export function parsePackageManifest(value: unknown, where: string): PackageManifest {
    if (!isRecord(value)) {
        throw new CatalogIntegrityError(`${where}: manifest is not an object`)
    }
    for (const field of ['id', 'displayName', 'description', 'version', 'maintainer', 'license']) {
        requireString(value, field, where)
    }
    if (value.type !== 'usecase' && value.type !== 'datastructure') {
        throw new CatalogIntegrityError(`${where}: type must be 'usecase' or 'datastructure'`)
    }
    if (!Array.isArray(value.keywords)) {
        throw new CatalogIntegrityError(`${where}: keywords is not an array`)
    }
    if (!isRecord(value.members)) {
        throw new CatalogIntegrityError(`${where}: members is missing`)
    }
    const members = value.members
    parseMembers(members.dataStructures, `${where}: members.dataStructures`)
    parseMembers(members.dataSources, `${where}: members.dataSources`)
    parseMembers(members.mappings, `${where}: members.mappings`)
    parseMembers(members.dataSinks, `${where}: members.dataSinks`)
    parseMembers(members.pipelines, `${where}: members.pipelines`)
    parseMembers(members.simulations, `${where}: members.simulations`)
    parseMembers(members.dashboards, `${where}: members.dashboards`)
    parseMembers(members.apis, `${where}: members.apis`)
    parseMembers(members.styles, `${where}: members.styles`)
    parseMembers(members.layers, `${where}: members.layers`)
    return value as unknown as PackageManifest
}

/** Generator kinds and their required numeric/array operands, mirroring the simulator's zod schema. */
const GENERATOR_KINDS: Record<string, string[]> = {
    constant: [],
    now: [],
    enum: ['values'],
    randomWalk: ['min', 'max', 'step'],
    dailyProfile: ['min', 'max', 'peakHours'],
    // Added with the SQL transport (D14); the catalogue validators had been
    // behind the generator, which has produced both since the POC.
    sequence: [],
    jitter: ['center', 'spread'],
}

/**
 * Resolves one step into a JSON-Schema object: follows a local `$ref`
 * (`#/$defs/...`) inside the structure document, then returns the schema node.
 * Only bundle-internal refs are followed — a catalogue structure referencing a
 * foreign URN is opaque here, and the walk stops with an error.
 */
function deref(node: Record<string, unknown>, root: Record<string, unknown>, where: string): Record<string, unknown> {
    const ref = node.$ref
    if (typeof ref !== 'string') return node
    if (!ref.startsWith('#/')) {
        throw new CatalogIntegrityError(`${where}: cannot follow external $ref '${ref}'`)
    }
    let target: unknown = root
    for (const segment of ref.slice(2).split('/')) {
        if (!isRecord(target) || !(segment in target)) {
            throw new CatalogIntegrityError(`${where}: $ref '${ref}' does not resolve`)
        }
        target = target[segment]
    }
    if (!isRecord(target)) throw new CatalogIntegrityError(`${where}: $ref '${ref}' is not an object`)
    return target
}

/**
 * Validates a simulation against the SOURCE structure it claims to feed.
 *
 * The check is two-directional. Subset: every dotted field path must exist in
 * the message class (with `$ref` resolution, so `pm25.value` walks through the
 * Measurement def). Coverage: every `required` property of the message class —
 * and of every nested object the paths step into — must be produced by at
 * least one field. Subset alone would not catch a scenario that forgets the
 * timestamp; coverage alone would not catch a typo'd field name.
 */
function validateSimulation(
    simulation: BundledSimulation,
    structureModel: Record<string, unknown>,
    where: string,
): void {
    // Resolve the message class: '#' is the structure root, '#/$defs/X' a class.
    const pointer = simulation.messageClass
    if (typeof pointer !== 'string' || (pointer !== '#' && !pointer.startsWith('#/'))) {
        throw new CatalogIntegrityError(`${where}: messageClass must be '#' or a '#/...' JSON pointer`)
    }
    const messageClass =
        pointer === '#'
            ? structureModel
            : deref({ $ref: pointer }, structureModel, where)

    // Walk one dotted path through the schema, resolving $refs at every step.
    const resolvePath = (path: string): { covered: Set<string> } => {
        const covered = new Set<string>()
        let node = deref(messageClass, structureModel, where)
        let walked = ''
        for (const segment of path.split('.')) {
            walked = walked ? `${walked}.${segment}` : segment
            const properties = node.properties
            if (!isRecord(properties) || !(segment in properties)) {
                throw new CatalogIntegrityError(
                    `${where}: field '${path}' — '${walked}' is not a property of ${simulation.messageClass}`,
                )
            }
            covered.add(walked)
            node = deref(properties[segment] as Record<string, unknown>, structureModel, `${where}: ${walked}`)
        }
        return { covered }
    }

    const units = isSqlSimulation(simulation)
        ? [{ name: 'Tabelle', fields: simulation.fields }]
        : simulation.streams

    if (isSqlSimulation(simulation)) {
        const columns = Object.keys(simulation.table?.columns ?? {})
        if (columns.length === 0) {
            throw new CatalogIntegrityError(`${where}: a SQL scenario must declare its table columns`)
        }

        const key = simulation.table?.primaryKey
        if (key && !columns.includes(key)) {
            throw new CatalogIntegrityError(
                `${where}: primaryKey '${key}' is not among the declared columns`,
            )
        }
        for (const name of Object.keys(simulation.fields ?? {})) {
            if (!columns.includes(name)) {
                throw new CatalogIntegrityError(
                    `${where}: field '${name}' is not a declared column of the table`,
                )
            }
        }
    }

    for (const stream of units) {
        const covered = new Set<string>()
        for (const [path, spec] of Object.entries(stream.fields)) {
            // Generator shape first — a wrong kind would only fail at the simulator.
            const generator = spec as GeneratorSpec
            const operands = GENERATOR_KINDS[generator.kind]
            if (!operands) {
                throw new CatalogIntegrityError(
                    `${where}: stream '${stream.name}' field '${path}' has unknown generator kind '${String(generator.kind)}'`,
                )
            }
            for (const operand of operands) {
                if (!(operand in (generator as unknown as Record<string, unknown>))) {
                    throw new CatalogIntegrityError(
                        `${where}: stream '${stream.name}' field '${path}' (${generator.kind}) is missing '${operand}'`,
                    )
                }
            }
            for (const prefix of resolvePath(path).covered) covered.add(prefix)
        }

        // Required coverage, top-level and one level into every object a path
        // steps into: producing pm25.value while omitting pm25.unit ships a
        // message the structure itself declares invalid.
        const requireCovered = (node: Record<string, unknown>, prefix: string) => {
            const required = node.required
            if (!Array.isArray(required)) return
            for (const name of required) {
                const full = prefix ? `${prefix}.${String(name)}` : String(name)
                const isCovered = [...covered].some((c) => c === full || c.startsWith(`${full}.`))
                if (!isCovered) {
                    throw new CatalogIntegrityError(
                        `${where}: stream '${stream.name}' does not produce required field '${full}' of ${simulation.messageClass}`,
                    )
                }
            }
        }
        requireCovered(deref(messageClass, structureModel, where), '')
        // For every covered object one level deep, check its own requireds.
        const parents = new Set([...covered].filter((c) => !c.includes('.')))
        for (const parent of parents) {
            const classNode = deref(messageClass, structureModel, where)
            const properties = classNode.properties
            if (!isRecord(properties) || !isRecord(properties[parent])) continue
            const child = deref(properties[parent] as Record<string, unknown>, structureModel, where)
            if (isRecord(child.properties) && [...covered].some((c) => c.startsWith(`${parent}.`))) {
                requireCovered(child, parent)
            }
        }
    }
}

/** The platform's rules for a named API (NamedApiInputDTO, NamedApiAllowedSlugValidator). */
const API_SLUG = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
const RESERVED_API_SLUGS = ['apis', 'usable-datasources', 'api', 'v1', 'admin']
const API_STANDARDS = ['OWS', 'STA', 'CUSTOM']
/** A layer name becomes a GeoServer feature-type name (LayerInputDTO). */
const LAYER_NAME = /^[A-Za-z_-][A-Za-z0-9_-]*$/
/** Style names: letters, digits, underscores and hyphens, as the platform's style endpoint takes them. */
const STYLE_NAME = /^[A-Za-z0-9_-]+$/

function optionalText(document: Record<string, unknown>, field: string, max: number, where: string): void {
    const value = document[field]
    if (value === undefined) return
    if (typeof value !== 'string' || value.length > max) {
        throw new CatalogIntegrityError(`${where}: ${field} must be text of at most ${max} characters`)
    }
}

function optionalStrings(document: Record<string, unknown>, field: string, where: string): string[] {
    const value = document[field]
    if (value === undefined) return []
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
        throw new CatalogIntegrityError(`${where}: ${field} must be a list of strings`)
    }
    return value as string[]
}

/**
 * Checks the geo members of a use case the way the platform will: each one by the rules of its
 * endpoint, and all of them together the way a release checks a dataset. A layer is served only
 * through an OWS API, an OWS API needs a PostGIS sink, an STA API a FROST sink — a package whose
 * release is certain to fail must not reach the install button. Layers reference sinks by title
 * and styles by name, like pipeline nodes reference their siblings.
 */
function validateGeoMembers(bundle: UseCaseEntry['bundle'], id: string): void {
    const apis = bundle.apis ?? []
    const styles = bundle.styles ?? []
    const layers = bundle.layers ?? []
    if (!apis.length && !styles.length && !layers.length) return

    const sinkTypes = new Map<string, string>()
    for (const sink of bundle.dataSinks) {
        if (typeof sink.document.title === 'string') {
            sinkTypes.set(sink.document.title, String(sink.document.connectionType ?? '').toLowerCase())
        }
    }

    const standards: string[] = []
    const slugs = new Set<string>()
    for (const api of apis) {
        const where = `${id}: api '${String(api.document.slug ?? api.document.name ?? '?')}'`
        requireString(api.document, 'name', where)
        const slug = requireString(api.document, 'slug', where)
        if (slug.length > 32 || !API_SLUG.test(slug)) {
            throw new CatalogIntegrityError(
                `${where}: slug must be lowercase letters and digits with inner hyphens, at most 32 characters`,
            )
        }
        if (RESERVED_API_SLUGS.includes(slug)) {
            throw new CatalogIntegrityError(`${where}: slug '${slug}' is reserved by the platform`)
        }
        if (slugs.has(slug)) {
            throw new CatalogIntegrityError(`${where}: slug '${slug}' is used twice`)
        }
        slugs.add(slug)
        const standard = requireString(api.document, 'standard', where).toUpperCase()
        if (!API_STANDARDS.includes(standard)) {
            throw new CatalogIntegrityError(`${where}: standard must be one of ${API_STANDARDS.join(', ')}`)
        }
        standards.push(standard)
        optionalText(api.document, 'version', 32, where)
        optionalText(api.document, 'description', 150, where)
    }
    if (standards.filter((standard) => standard === 'OWS').length > 1) {
        throw new CatalogIntegrityError(`${id}: a dataset serves at most one OWS api`)
    }
    const sinkKinds = [...sinkTypes.values()]
    if (standards.includes('OWS') && !sinkKinds.includes('postgis')) {
        throw new CatalogIntegrityError(`${id}: an OWS api needs a bundled PostGIS data sink to serve`)
    }
    if (standards.includes('STA') && !sinkKinds.includes('frost')) {
        throw new CatalogIntegrityError(`${id}: an STA api needs a bundled FROST data sink to serve`)
    }

    const styleNames = new Set<string>()
    for (const style of styles) {
        const where = `${id}: style '${String(style.document.name ?? '?')}'`
        const name = requireString(style.document, 'name', where)
        if (!STYLE_NAME.test(name)) {
            throw new CatalogIntegrityError(`${where}: name may contain only letters, digits, underscores and hyphens`)
        }
        if (styleNames.has(name)) {
            throw new CatalogIntegrityError(`${where}: name '${name}' is used twice`)
        }
        styleNames.add(name)
        requireString(style.document, 'sldContent', where)
    }

    if (layers.length && !standards.includes('OWS')) {
        throw new CatalogIntegrityError(`${id}: layers need an OWS api that serves them`)
    }
    const layerNames = new Set<string>()
    for (const layer of layers) {
        const where = `${id}: layer '${String(layer.document.layerName ?? '?')}'`
        const name = requireString(layer.document, 'layerName', where)
        if (!LAYER_NAME.test(name)) {
            throw new CatalogIntegrityError(
                `${where}: layerName may contain only letters, digits, underscores and hyphens and must not start with a digit`,
            )
        }
        if (layerNames.has(name)) {
            throw new CatalogIntegrityError(`${where}: layerName '${name}' is used twice`)
        }
        layerNames.add(name)
        const sinkRef = requireString(layer.document, 'sinkRef', where)
        if (!sinkRef.startsWith('urn:') && !sinkTypes.has(sinkRef)) {
            throw new CatalogIntegrityError(`${where}: sinkRef '${sinkRef}' matches no bundled datasink title`)
        }
        const defaultStyle = layer.document.defaultStyleRef
        if (defaultStyle !== undefined && typeof defaultStyle !== 'string') {
            throw new CatalogIntegrityError(`${where}: defaultStyleRef must be a style name`)
        }
        const styleRefs = [
            ...(typeof defaultStyle === 'string' ? [defaultStyle] : []),
            ...optionalStrings(layer.document, 'alternativeStyleRefs', where),
        ]
        for (const ref of styleRefs) {
            if (!ref.startsWith('urn:') && !styleNames.has(ref)) {
                throw new CatalogIntegrityError(`${where}: style '${ref}' matches no bundled style name`)
            }
        }
        optionalStrings(layer.document, 'attribute', where)
        optionalStrings(layer.document, 'keywords', where)
        if ((layer.document.nativeBoundingBox === undefined) !== (layer.document.latLonBoundingBox === undefined)) {
            throw new CatalogIntegrityError(
                `${where}: nativeBoundingBox and latLonBoundingBox must be set together or both be left out`,
            )
        }
    }
}

/** Reader for one member file; the two sources differ only in this function. */
export type MemberReader = (file: string) => Record<string, unknown>

export function assembleCatalogEntry(
    manifest: PackageManifest,
    readMember: MemberReader,
): CatalogEntry {
    const read = (member: PackageMember): Record<string, unknown> => {
        const document = readMember(member.file)
        if (!isRecord(document)) {
            throw new CatalogIntegrityError(`${manifest.id}: member '${member.file}' is not a JSON object`)
        }
        return document
    }

    if (manifest.type === 'datastructure') {
        const structureMembers = manifest.members.dataStructures
        if (structureMembers.length !== 1) {
            throw new CatalogIntegrityError(
                `${manifest.id}: a datastructure entry has exactly one dataStructures member, found ${structureMembers.length}`,
            )
        }
        const artifact = read(structureMembers[0])
        // Identity crosscheck: for a datastructure entry the catalogue id IS
        // the artifact's CORE URN — a file whose $id says otherwise is the
        // wrong file, however it got there.
        if (artifact.$id !== manifest.id) {
            throw new CatalogIntegrityError(
                `${manifest.id}: artifact $id '${String(artifact.$id)}' does not match the entry id`,
            )
        }
        return {
            manifest: manifest as DataStructureEntry['manifest'],
            artifact,
        }
    }

    const bundle: UseCaseEntry['bundle'] = {
        // A structure's display name and description live in the schema itself
        // (title/description) — the package lists only the file, so there is
        // exactly one place where the name can be edited.
        dataStructures: manifest.members.dataStructures.map((member) => {
            const model = read(member)
            const title = model.title
            if (typeof title !== 'string' || title.length === 0) {
                throw new CatalogIntegrityError(
                    `${manifest.id}: structure '${member.file}' has no title`,
                )
            }
            return {
                name: title,
                description: typeof model.description === 'string' ? model.description : undefined,
                model,
            }
        }),
        dataSources: (manifest.members.dataSources ?? []).map((member) => ({
            document: read(member),
            parameters: member.parameters,
        })),
        mappings: (manifest.members.mappings ?? []).map((member) => {
            const mapping = read(member)
            requireString(mapping, 'mappingUrn', `${manifest.id}: mapping '${member.file}'`)
            requireString(mapping, 'name', `${manifest.id}: mapping '${member.file}'`)
            if (!isRecord(mapping.document)) {
                throw new CatalogIntegrityError(
                    `${manifest.id}: mapping '${member.file}' has no document`,
                )
            }
            return mapping as unknown as BundledMapping
        }),
        dataSinks: (manifest.members.dataSinks ?? []).map((member) => ({
            document: read(member),
            parameters: member.parameters,
        })),
        pipelines: (manifest.members.pipelines ?? []).map((member) => {
            const pipeline = read(member)
            requireString(pipeline, 'name', `${manifest.id}: pipeline '${member.file}'`)
            if (!isRecord(pipeline.model)) {
                throw new CatalogIntegrityError(
                    `${manifest.id}: pipeline '${member.file}' has no model`,
                )
            }
            return pipeline as unknown as BundledPipeline
        }),
        simulations: [],
        dashboards: (manifest.members.dashboards ?? []).map((member) => ({
            file: member.file,
            content: read(member),
        })),
        apis: (manifest.members.apis ?? []).map((member) => ({ document: read(member) })),
        styles: (manifest.members.styles ?? []).map((member) => ({ document: read(member) })),
        layers: (manifest.members.layers ?? []).map((member) => ({ document: read(member) })),
    }
    validateGeoMembers(bundle, manifest.id)

    // Simulations resolve against the datasources and structures above, so they
    // are assembled after the rest of the bundle exists.
    bundle.simulations = (manifest.members.simulations ?? []).map((member) => {
            const where = `${manifest.id}: simulation '${member.file}'`
            const document = read(member)
            requireString(document, 'sourceRef', where)
            requireString(document, 'messageClass', where)
            if (document.transport === 'sql') {
                // A SQL scenario describes a table, not a topic and streams.
                if (!isRecord(document.table)) {
                    throw new CatalogIntegrityError(`${where} needs a 'table' with columns`)
                }
                if (!isRecord(document.fields) || Object.keys(document.fields).length === 0) {
                    throw new CatalogIntegrityError(`${where} needs a non-empty fields object`)
                }
                if (typeof document.maxRows !== 'number') {
                    throw new CatalogIntegrityError(
                        `${where} needs maxRows — every pipeline run re-reads the whole table`,
                    )
                }
                requireOptionalLabel(document.label, where)
            } else {
                requireString(document, 'topicBase', where)
                if (!Array.isArray(document.streams) || document.streams.length === 0) {
                    throw new CatalogIntegrityError(`${where} needs a non-empty streams array`)
                }
                for (const stream of document.streams) {
                    if (isRecord(stream)) requireOptionalLabel(stream.label, `${where}, stream '${String(stream.name)}'`)
                }
            }
            const simulation = document as unknown as BundledSimulation

            // The scenario feeds a bundled datasource; resolve it by its title
            // (the bundle-local handle), then the SOURCE structure by the URN
            // the datasource's `element` names — the same resolution the
            // platform performs at install time.
            const source = bundle.dataSources.find(
                (candidate) => candidate.document.title === simulation.sourceRef,
            )
            if (!source) {
                throw new CatalogIntegrityError(
                    `${where}: sourceRef '${simulation.sourceRef}' matches no bundled datasource title`,
                )
            }
            const structure = bundle.dataStructures.find(
                (candidate) => candidate.model.$id === source.document.element,
            )
            if (!structure) {
                throw new CatalogIntegrityError(
                    `${where}: datasource '${simulation.sourceRef}' names structure '${String(source.document.element)}', which is not bundled`,
                )
            }
            // topicBase must agree with the datasource's subscription — exactly,
            // or as its one-level-wildcard prefix. Field paths were validated from
            // day one while the topic was not, and the gap shipped a scenario that
            // published one level below an exact subscription: running streams,
            // zero rows, no error anywhere.
            if (isSqlSimulation(simulation)) {
                if (source.document.connectionType !== 'sql') {
                    throw new CatalogIntegrityError(
                        `${where}: a SQL scenario needs a SQL datasource, but '${simulation.sourceRef}' is '${String(source.document.connectionType)}'`,
                    )
                }
                if (typeof source.document.table !== 'string' || !source.document.table) {
                    throw new CatalogIntegrityError(
                        `${where}: datasource '${simulation.sourceRef}' names no table to fill`,
                    )
                }
            } else {
                const topics = source.document.topics
                const subscription =
                    Array.isArray(topics) && typeof topics[0] === 'string' ? topics[0] : undefined
                if (!subscription) {
                    throw new CatalogIntegrityError(
                        `${where}: datasource '${simulation.sourceRef}' declares no MQTT topics to publish into`,
                    )
                }
                if (
                    subscription !== simulation.topicBase &&
                    subscription !== `${simulation.topicBase}/+` &&
                    subscription !== `${simulation.topicBase}/#`
                ) {
                    throw new CatalogIntegrityError(
                        `${where}: topicBase '${simulation.topicBase}' does not match the datasource subscription '${subscription}'`,
                    )
                }
            }
            validateSimulation(simulation, structure.model, where)
            return simulation
        })

    return { manifest: manifest as UseCaseEntry['manifest'], bundle }
}
