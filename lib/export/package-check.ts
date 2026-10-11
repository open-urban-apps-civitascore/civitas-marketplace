/**
 * The essential rules of the package repos' `ci/validate-bundle.py`, in
 * TypeScript, so an export can refuse to open a merge request for a package
 * the repository's own CI would reject. Mirrors the script; the script stays
 * the authority and travels with every exported package.
 */

const CORE = 'core-ir'
const MEMBER_KINDS = [
    'dataStructures',
    'dataSources',
    'mappings',
    'dataSinks',
    'pipelines',
    'simulations',
    'dashboards',
    'apis',
    'styles',
    'layers',
] as const

/**
 * The structures the platform publishes for its FROST sink ports, by port. A
 * package cannot reference them yet: the portal creates a sink only for an
 * element in its own structure list, where these are missing, and refuses the
 * install with "Referenced DataStructure is not available". A package bundles a
 * copy of the one it needs instead. Exact logical URNs, as the script lists them.
 */
const FROST_PORT_STRUCTURES: Record<string, string> = {
    Things: 'urn:core:platform:civitas:datastructure:frost:Things:4eg5hgeyxv',
    Observations: 'urn:core:platform:civitas:datastructure:frost:Observations:4sntm03fzg',
    ThingTree: 'urn:core:platform:civitas:datastructure:frost:ThingTree:r32e0hmgn1',
}
const FROST_PORTS = Object.keys(FROST_PORT_STRUCTURES)
const PLATFORM_FROST_STRUCTURES = new Set(Object.values(FROST_PORT_STRUCTURES))

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/** Every '#/...' $ref inside a node, in document order. */
function localRefs(node: unknown): string[] {
    if (Array.isArray(node)) return node.flatMap(localRefs)
    if (!isRecord(node)) return []
    const own = typeof node.$ref === 'string' && node.$ref.startsWith('#/') ? [node.$ref] : []
    return [...own, ...Object.values(node).flatMap(localRefs)]
}

/** `files` is keyed by path relative to the package directory (`core-ir/manifest.json`, …). */
export function checkPackage(files: Record<string, string>): string[] {
    const errors: string[] = []
    const fail = (message: string) => errors.push(message)

    const load = (path: string): unknown => {
        const raw = files[path]
        if (raw === undefined) return undefined
        try {
            return JSON.parse(raw)
        } catch (error) {
            fail(`${path}: invalid JSON (${String(error)})`)
            return undefined
        }
    }

    const manifestPath = `${CORE}/manifest.json`
    const manifest = load(manifestPath)
    if (!isRecord(manifest)) return [`${manifestPath} is missing or not an object`]

    for (const field of ['id', 'type', 'version', 'displayName', 'description', 'maintainer', 'license', 'keywords', 'members', 'dependencies']) {
        if (!(field in manifest)) fail(`manifest.json is missing required field '${field}'`)
    }
    if (manifest.type !== 'usecase' && manifest.type !== 'datastructure') {
        fail(`manifest.json: type must be 'usecase' or 'datastructure', got ${JSON.stringify(manifest.type)}`)
    }

    const members = isRecord(manifest.members) ? manifest.members : {}
    const listed: { kind: string; name: string }[] = []
    for (const kind of MEMBER_KINDS) {
        const entries = members[kind]
        if (entries === undefined) continue
        if (!Array.isArray(entries)) {
            fail(`members.${kind} is not an array`)
            continue
        }
        entries.forEach((member, index) => {
            if (!isRecord(member) || !nonEmptyString(member.file)) {
                fail(`members.${kind}[${index}] needs a 'file' string`)
                return
            }
            listed.push({ kind, name: member.file })
        })
    }

    const onDisk = new Set(
        Object.keys(files)
            .filter((path) => path.startsWith(`${CORE}/`) && path.endsWith('.json'))
            .map((path) => path.slice(CORE.length + 1)),
    )
    for (const { kind, name } of listed) {
        if (!onDisk.has(name)) fail(`members.${kind} lists '${name}' but ${CORE}/${name} does not exist`)
    }
    for (const name of [...onDisk].sort()) {
        if (name !== 'manifest.json' && !listed.some((m) => m.name === name)) {
            fail(`${CORE}/${name} exists but is not listed in manifest members`)
        }
    }

    const documents = new Map<string, { kind: string; document: Record<string, unknown> }>()
    for (const { kind, name } of listed) {
        const document = load(`${CORE}/${name}`)
        if (isRecord(document)) documents.set(name, { kind, document })
    }

    const structureIds = new Set<string>()
    const sourceTitles = new Set<string>()
    const sinkTitles = new Set<string>()
    const mappingNames = new Set<string>()
    const styleNames = new Set<string>()
    // Pipelines name their sink by title or id, their mapping by name or URN.
    const sinksByRef = new Map<string, Record<string, unknown>>()
    const mappingsByRef = new Map<string, Record<string, unknown>>()

    for (const [name, { kind, document }] of documents) {
        const where = `${CORE}/${name}`
        if (kind === 'dataStructures') {
            if (!nonEmptyString(document.$id) || !document.$id.startsWith('urn:core:')) {
                fail(`${where}: structure needs a CORE-URN $id`)
            } else {
                structureIds.add(document.$id)
            }
            if (!nonEmptyString(document.title)) fail(`${where}: structure needs a title`)
            // The install gives every $defs member its own $id, and a '#/...' reference
            // resolves against the nearest $id: inside a member it then searches only
            // that member, and the portal refuses the import with "Invalid JSON Schema".
            // That is a limitation of our install, not of the platform: the portal's
            // own import accepts such a structure, so an instance can hold one. It is
            // an error and not a warning because the script the package ships fails it
            // too, and a merge request the repository's CI rejects helps no one.
            if (isRecord(document.$defs)) {
                for (const [member, definition] of Object.entries(document.$defs)) {
                    for (const ref of localRefs(definition)) {
                        fail(
                            `${where}: $defs member '${member}' refers to '${ref}'; the install gives every member ` +
                                `its own $id, so this no longer resolves (a limitation of the install, not of the ` +
                                `platform). Write the definition out inside '${member}'`,
                        )
                    }
                }
            }
        } else if (kind === 'dataSources' || kind === 'dataSinks') {
            for (const field of ['$schema', 'id', 'title', 'connectionType']) {
                if (!nonEmptyString(document[field])) fail(`${where}: connector needs field '${field}'`)
            }
            if (nonEmptyString(document.title)) {
                ;(kind === 'dataSources' ? sourceTitles : sinkTitles).add(document.title)
            }
            if (kind === 'dataSinks') {
                for (const key of ['title', 'id']) {
                    const ref = document[key]
                    if (typeof ref === 'string') sinksByRef.set(ref, document)
                }
                // A dataset does not release with a FROST sink that has no port.
                const port = document.port
                if (document.connectionType === 'frost' && (typeof port !== 'string' || !FROST_PORTS.includes(port))) {
                    fail(`${where}: a FROST sink needs a port, one of ${FROST_PORTS.join(', ')}`)
                }
            }
        } else if (kind === 'mappings') {
            for (const field of ['mappingUrn', 'name']) {
                if (!nonEmptyString(document[field])) fail(`${where}: mapping needs field '${field}'`)
            }
            const inner = document.document
            if (!isRecord(inner)) {
                fail(`${where}: mapping needs an object field 'document'`)
            } else {
                for (const field of ['source', 'target', 'fields']) {
                    if (!(field in inner)) fail(`${where}: mapping document needs field '${field}'`)
                }
            }
            if (nonEmptyString(document.name)) mappingNames.add(document.name)
            if (nonEmptyString(document.mappingUrn)) mappingNames.add(document.mappingUrn)
            for (const key of ['name', 'mappingUrn']) {
                const ref = document[key]
                if (typeof ref === 'string') mappingsByRef.set(ref, document)
            }
        } else if (kind === 'pipelines') {
            if (!nonEmptyString(document.name)) fail(`${where}: pipeline needs field 'name'`)
            if (!isRecord(document.model) || !Array.isArray(document.model.nodes)) {
                fail(`${where}: pipeline needs model.nodes`)
            }
        } else if (kind === 'apis') {
            for (const field of ['name', 'slug', 'standard']) {
                if (!nonEmptyString(document[field])) fail(`${where}: api needs field '${field}'`)
            }
        } else if (kind === 'styles') {
            for (const field of ['name', 'sldContent']) {
                if (!nonEmptyString(document[field])) fail(`${where}: style needs field '${field}'`)
            }
            if (nonEmptyString(document.name)) styleNames.add(document.name)
        } else if (kind === 'layers') {
            for (const field of ['layerName', 'sinkRef']) {
                if (!nonEmptyString(document[field])) fail(`${where}: layer needs field '${field}'`)
            }
        }
    }

    for (const [name, { kind, document }] of documents) {
        const where = `${CORE}/${name}`
        if (kind === 'mappings' && isRecord(document.document)) {
            for (const side of ['source', 'target']) {
                const ref = document.document[side]
                if (typeof ref !== 'string') continue
                if (PLATFORM_FROST_STRUCTURES.has(ref)) {
                    fail(`${where}: mapping ${side} '${ref}' is a platform FROST structure; bundle a copy of it`)
                } else if (!structureIds.has(ref)) {
                    fail(`${where}: mapping ${side} '${ref}' is not a bundled structure $id`)
                }
            }
        }
        if (kind === 'dataSinks' && document.connectionType === 'frost') {
            const element = document.element
            if (typeof element === 'string' && PLATFORM_FROST_STRUCTURES.has(element)) {
                fail(`${where}: element '${element}' is a platform FROST structure; the portal refuses it, bundle a copy`)
            } else if (element !== undefined && element !== null && !structureIds.has(element as string)) {
                fail(`${where}: element '${String(element)}' is not a bundled structure $id`)
            }
        }
        if (kind === 'pipelines' && isRecord(document.model) && Array.isArray(document.model.nodes)) {
            for (const node of document.model.nodes) {
                if (!isRecord(node)) continue
                const checks: [string, Set<string>, string][] = [
                    ['sourceRef', sourceTitles, 'datasource title'],
                    ['sinkRef', sinkTitles, 'datasink title'],
                    ['mappingRef', mappingNames, 'mapping name/urn'],
                ]
                for (const [field, known, label] of checks) {
                    const ref = node[field]
                    if (typeof ref === 'string' && !ref.startsWith('urn:') && !known.has(ref)) {
                        fail(`${where}: node '${String(node.id)}' ${field} '${ref}' matches no bundled ${label}`)
                    }
                }
            }
            // A mapped FROST flow takes its match keys from the sink's element, so it
            // must be the structure the last mapping writes. Pipelines are linear, and
            // the script reads "last" in node order, so this does too.
            const nodes = document.model.nodes.filter(isRecord)
            const sinkRef = nodes.find((node) => node.kind === 'sink')?.sinkRef
            const sink = typeof sinkRef === 'string' ? sinksByRef.get(sinkRef) : undefined
            const mappingRefs = nodes.filter((node) => node.kind === 'mapping').map((node) => node.mappingRef)
            if (sink?.connectionType === 'frost' && mappingRefs.length > 0) {
                const lastRef = mappingRefs[mappingRefs.length - 1]
                const mapping = typeof lastRef === 'string' ? mappingsByRef.get(lastRef) : undefined
                const target = mapping && isRecord(mapping.document) ? mapping.document.target : undefined
                if (target && sink.element !== target) {
                    fail(
                        `${where}: FROST sink '${String(sink.title)}' must name the last mapping's target ` +
                            `'${String(target)}' as its element, or the release cannot find the match keys`,
                    )
                }
            }
        }
        if (kind === 'layers') {
            const sinkRef = document.sinkRef
            if (typeof sinkRef === 'string' && !sinkRef.startsWith('urn:') && !sinkTitles.has(sinkRef)) {
                fail(`${where}: sinkRef '${sinkRef}' matches no bundled datasink title`)
            }
            const styleRefs = [
                document.defaultStyleRef,
                ...(Array.isArray(document.alternativeStyleRefs) ? document.alternativeStyleRefs : []),
            ]
            for (const ref of styleRefs) {
                if (typeof ref === 'string' && !ref.startsWith('urn:') && !styleNames.has(ref)) {
                    fail(`${where}: style '${ref}' matches no bundled style name`)
                }
            }
        }
    }

    const structureMembers = Array.isArray(members.dataStructures) ? members.dataStructures : []
    if (manifest.type === 'usecase' && structureMembers.length === 0) {
        fail('usecase entry needs at least one dataStructures member')
    }
    return errors
}
