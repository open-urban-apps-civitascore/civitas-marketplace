/**
 * What the marketplace's own merge requests say about themselves, read back:
 * the titles and descriptions are written by `exportAction`, so the list of
 * shared packages can take names from them instead of asking GitLab for more.
 */

/** The display name inside an export request's title ("Export use case: <name> <version>"). */
export function displayNameOf(title: string | undefined, version: string): string | undefined {
    const match = title?.match(/^Export use case: (.+) (\d+\.\d+\.\d+)$/)
    return match && match[2] === version ? match[1] : undefined
}

/** Who a request was proposed for, from its first line; undefined when it does not name anyone. */
export function proposerOf(description: string | null | undefined): string | undefined {
    const name = description?.match(/^Proposed by the Open Urban Apps marketplace on behalf of \*\*(.+?)\*\*\./m)?.[1]?.trim()
    return name && name !== 'unbekannt' ? name : undefined
}

/**
 * Whom a withdrawal was made for, from the note the marketplace leaves on a
 * merge request it closes (`withdrawalNote` in share-deletion.ts); undefined
 * for any other comment. The bot account is also used by hand, so a request
 * it closed counts as withdrawn only with this note.
 */
export function withdrawerOf(body: string | null | undefined): string | undefined {
    const name = body?.match(/^Withdrawn through the Open Urban Apps marketplace on behalf of \*\*(.+?)\*\*\./m)?.[1]?.trim()
    return name || undefined
}

/**
 * Whether a share was proposed for someone else than `person`: both named,
 * and not the same name. A share that names nobody counts as nobody else's.
 * Names are compared as the person sees them (display names, case aside),
 * so two people of the same name count as one (plan of 2026-10-18, risks).
 */
export function proposedByOther(proposedBy: string | undefined, person: string | undefined): boolean {
    return Boolean(proposedBy && person && proposedBy.trim().toLowerCase() !== person.trim().toLowerCase())
}

/**
 * Where a share came from: the dataset it was built from, and the instance
 * that shared it (`thisInstance`). Either may be unknown; nothing is ever
 * guessed from a name, because several instances share one GitLab account
 * and one package id.
 */
export interface ShareSource {
    kind: 'dataset'
    /** The dataset's id on the instance it came from. */
    id?: string
    instance?: string
}

const SOURCE_LINE = /^<!-- oua-share (\{.*\}) -->$/m

/**
 * The hidden line every new proposal carries (plan of 2026-10-18, section
 * 10), at the end of its description: GitLab shows nothing of an HTML
 * comment, and the listing reads it back with {@link shareSourceOf}. Angle
 * brackets in a value are escaped, so no value can end the comment early.
 */
export function shareSourceLine(source: ShareSource): string {
    const fields = { kind: source.kind, ...(source.id ? { id: source.id } : {}), ...(source.instance ? { instance: source.instance } : {}) }
    return `<!-- oua-share ${JSON.stringify(fields).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')} -->`
}

/** The source line of a proposal, read back; undefined for a proposal without one (made before rc.6, or by hand) or a garbled one. */
export function shareSourceOf(description: string | null | undefined): ShareSource | undefined {
    const raw = description?.match(SOURCE_LINE)?.[1]
    if (!raw) return undefined
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return undefined
    }
    if (!parsed || typeof parsed !== 'object') return undefined
    const { kind, id, instance } = parsed as Record<string, unknown>
    if (kind !== 'dataset') return undefined
    const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
    return { kind, ...(text(id) ? { id: text(id) } : {}), ...(text(instance) ? { instance: text(instance) } : {}) }
}

/**
 * The source of an older share, from its package README (`readme` in
 * transform.ts): "(dataset `<name>`, id `<id>`, instance <url>)." The
 * instance is there only where the exporting instance had `PORTAL_URL` set.
 * Undefined when the README says neither, or was changed beyond recognition.
 */
export function readmeSourceOf(readme: string | undefined): ShareSource | undefined {
    const match = readme?.match(/^\(dataset `[^`\n]*`, id `([^`\n]+)`(?:, instance ([^\s)]+))?\)\.$/m)
    if (!match) return undefined
    return { kind: 'dataset', id: match[1], ...(match[2] ? { instance: match[2] } : {}) }
}

/**
 * The repository and folder a catalogue proposal pins, from the sentence
 * `proposeCatalog` writes ("pinned to `<sha>` of <url> (path `<dir>`)");
 * undefined for a proposal that names none. The catalogue's branch names no
 * repository, so this is what tells two targets' packages of one name apart.
 */
export function catalogPinOf(description: string | null | undefined): { repo: string; path: string } | undefined {
    const match = description?.match(/pinned to\s+`[0-9a-f]+` of (\S+) \(path `([^`]+)`\)/)
    return match ? { repo: match[1], path: match[2] } : undefined
}
