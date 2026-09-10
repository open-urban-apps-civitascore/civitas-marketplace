/**
 * The essential rules of the package repos' `ci/validate-bundle.py`, in
 * TypeScript, so an export can refuse to open a merge request for a package
 * the repository's own CI would reject. Mirrors the script; the script stays
 * the authority and travels with every exported package.
 */

const CORE = 'core-ir'
const MEMBER_KINDS = ['dataStructures', 'dataSources', 'mappings', 'dataSinks', 'pipelines', 'simulations', 'dashboards'] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

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
            .filter((path) => path.startsWith(`${CORE}/`) && (path.endsWith('.json') || path.endsWith('.zip')))
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

    for (const [name, { kind, document }] of documents) {
        const where = `${CORE}/${name}`
        if (kind === 'dataStructures') {
            if (!nonEmptyString(document.$id) || !document.$id.startsWith('urn:core:')) {
                fail(`${where}: structure needs a CORE-URN $id`)
            } else {
                structureIds.add(document.$id)
            }
            if (!nonEmptyString(document.title)) fail(`${where}: structure needs a title`)
        } else if (kind === 'dataSources' || kind === 'dataSinks') {
            for (const field of ['$schema', 'id', 'title', 'connectionType']) {
                if (!nonEmptyString(document[field])) fail(`${where}: connector needs field '${field}'`)
            }
            if (nonEmptyString(document.title)) {
                ;(kind === 'dataSources' ? sourceTitles : sinkTitles).add(document.title)
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
        } else if (kind === 'pipelines') {
            if (!nonEmptyString(document.name)) fail(`${where}: pipeline needs field 'name'`)
            if (!isRecord(document.model) || !Array.isArray(document.model.nodes)) {
                fail(`${where}: pipeline needs model.nodes`)
            }
        }
    }

    for (const [name, { kind, document }] of documents) {
        const where = `${CORE}/${name}`
        if (kind === 'mappings' && isRecord(document.document)) {
            for (const side of ['source', 'target']) {
                const ref = document.document[side]
                if (typeof ref === 'string' && !structureIds.has(ref)) {
                    fail(`${where}: mapping ${side} '${ref}' is not a bundled structure $id`)
                }
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
        }
    }

    const structureMembers = Array.isArray(members.dataStructures) ? members.dataStructures : []
    if (manifest.type === 'usecase' && structureMembers.length === 0) {
        fail('usecase entry needs at least one dataStructures member')
    }
    return errors
}
