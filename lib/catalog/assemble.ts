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

function parseMembers(value: unknown, where: string): PackageMember[] {
    if (value === undefined) return []
    if (!Array.isArray(value)) {
        throw new CatalogIntegrityError(`${where} is not an array`)
    }
    return value.map((member, index) => {
        if (!isRecord(member)) {
            throw new CatalogIntegrityError(`${where}[${index}] is not an object`)
        }
        requireString(member, 'file', `${where}[${index}]`)
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
    return value as unknown as PackageManifest
}

/** Generator kinds and their required numeric/array operands, mirroring the simulator's zod schema. */
const GENERATOR_KINDS: Record<string, string[]> = {
    constant: [],
    now: [],
    enum: ['values'],
    randomWalk: ['min', 'max', 'step'],
    dailyProfile: ['min', 'max', 'peakHours'],
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

    for (const stream of simulation.streams) {
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
    }

    // Simulations resolve against the datasources and structures above, so they
    // are assembled after the rest of the bundle exists.
    bundle.simulations = (manifest.members.simulations ?? []).map((member) => {
            const where = `${manifest.id}: simulation '${member.file}'`
            const document = read(member)
            requireString(document, 'sourceRef', where)
            requireString(document, 'messageClass', where)
            requireString(document, 'topicBase', where)
            if (!Array.isArray(document.streams) || document.streams.length === 0) {
                throw new CatalogIntegrityError(`${where} needs a non-empty streams array`)
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
            validateSimulation(simulation, structure.model, where)
            return simulation
        })

    return { manifest: manifest as UseCaseEntry['manifest'], bundle }
}
