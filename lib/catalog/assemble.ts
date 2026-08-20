import type {
    BundledMapping,
    BundledPipeline,
    CatalogEntry,
    DataStructureEntry,
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
    return value as unknown as PackageManifest
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
    }

    return { manifest: manifest as UseCaseEntry['manifest'], bundle }
}
