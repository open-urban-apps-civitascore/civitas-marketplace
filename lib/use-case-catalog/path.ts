/**
 * Readable URLs for catalogue entries.
 *
 * A catalogue id is a URN `urn:openurbanapps:usecase:verkehrszaehlung` and
 * putting one in a path spells it `urn%3Aopenurbanapps%3Ausecase%3A…`, because
 * every colon has to be percent-encoded. The URN stays the identity; this is
 * only its address, so it drops the two constant parts (`urn`, and the type,
 * which the route already says) and keeps publisher and name:
 *
 *     /use-cases/openurbanapps/verkehrszaehlung
 *
 * A path is MATCHED against the catalogue, never parsed back into a URN. That is
 * what makes it safe: the mapping only has to be stable and unique, not
 * reversible, so an id in a shape nobody anticipated still resolves instead of
 * producing a 404 or, worse, a wrong entry.
 */

export interface EntryPath {
    publisher: string
    slug: string
}

/** Lower-case, URL-safe, and applied to both sides of every comparison. */
function segment(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

export function catalogEntryPath(id: string): EntryPath {
    const [prefix, publisher, type, ...rest] = id.split(':')
    if (prefix === 'urn' && publisher && type === 'usecase' && rest.length > 0) {
        return { publisher: segment(publisher), slug: segment(rest.join('-')) }
    }
    // Any other shape: keep something stable and readable rather than throwing.
    // Both the link and the lookup run through here, so they still agree.
    const parts = id.split(':').filter(Boolean)
    return {
        publisher: segment(parts[1] ?? 'katalog') || 'katalog',
        slug: segment(parts.at(-1) ?? id) || 'eintrag',
    }
}

export function catalogEntryHref(id: string): string {
    const { publisher, slug } = catalogEntryPath(id)
    return `/use-cases/${publisher}/${slug}`
}

export function matchesEntryPath(id: string, publisher: string, slug: string): boolean {
    const path = catalogEntryPath(id)
    return path.publisher === segment(publisher) && path.slug === segment(slug)
}

export function isCanonicalPath(id: string, publisher: string, slug: string): boolean {
    const path = catalogEntryPath(id)
    return path.publisher === publisher && path.slug === slug
}

export function resolveEntryPath<T extends { id: string }>(
    entries: readonly T[],
    publisher: string,
    slug: string,
): T | undefined {
    const matches = entries.filter((entry) => matchesEntryPath(entry.id, publisher, slug))
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) {
        console.error(
            `[catalog] /${publisher}/${slug} is ambiguous — ${matches
                .map((entry) => entry.id)
                .join(', ')} all address it. Refusing to guess.`,
        )
    }
    return undefined
}
