/**
 * Free-text search across a catalog entry's *properties* — "Filter bei Suche
 * nach allen Eigenschaften".
 *
 * The naive version of this is `JSON.stringify(entry).includes(query)`. It is
 * wrong, not merely slow: it drags in commit SHAs, URL templates, image URLs
 * and placeholder hex colours, so a query of `"2"` or `"http"` matches every
 * row. Each catalog therefore enumerates the fields that carry meaning to a
 * reader (see `useCaseSearchText` and friends) and this module only does the
 * matching.
 */

/**
 * Lowercase and fold German umlauts, so "Grünflächen", "Grunflachen" and
 * "Gruenflaechen" all find the same rows — people type all three.
 */
export function foldGerman(value: string): string {
    return value
        .toLowerCase()
        .replaceAll('ä', 'ae')
        .replaceAll('ö', 'oe')
        .replaceAll('ü', 'ue')
        .replaceAll('ß', 'ss')
}

/** Joins the parts of a haystack, dropping absent values. */
export const searchText = (...parts: (string | undefined | null)[]): string =>
    parts.filter(Boolean).join(' ')

/**
 * Builds `key → folded haystack` once per list. Called inside a `useMemo` keyed
 * on the entries, so typing costs one `String.includes` per token per entry
 * rather than a walk over nested objects.
 */
export function buildSearchIndex<T>(
    entries: T[],
    keyOf: (entry: T) => string,
    textOf: (entry: T) => string,
): Map<string, string> {
    return new Map(entries.map((entry) => [keyOf(entry), foldGerman(textOf(entry))]))
}

/**
 * Every whitespace-separated token must be present. Token-AND rather than one
 * substring match means "verkehr musterhausen" works regardless of the order
 * the two words happen to appear in the entry.
 */
export function matchesQuery(haystack: string, query: string): boolean {
    const tokens = foldGerman(query).split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return true
    return tokens.every((token) => haystack.includes(token))
}
