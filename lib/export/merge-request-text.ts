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
