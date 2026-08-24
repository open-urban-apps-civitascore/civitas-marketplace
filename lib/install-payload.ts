/**
 * Pure helpers for the install payloads. Separate from `install-actions.ts` because that file is
 * a `'use server'` module, where every export must be an async server action — a synchronous
 * helper cannot live there, and a pure function is worth testing on its own.
 */

/**
 * The portal caps every description at this length: `MAX_DESCRIPTION_LENGTH` in its
 * `types/common.ts`, applied as `z.string().trim().max(…)` to structures, sources and datasets
 * alike. It is a frontend rule — the API stores an over-long text without complaint, so the
 * problem only surfaces later, when the edit form refuses to save until someone rewrites text
 * they did not author.
 *
 * Because the constant is portal-wide rather than per-form, every description this app sends
 * goes through the clamp, not just the fields whose forms are known to enforce it today.
 */
export const DESCRIPTION_MAX_LENGTH = 150

/**
 * Fits a catalogue description into the portal's description field.
 *
 * The catalogue's own text is the right length for the catalogue — the package page shows it in
 * full, and the schema keeps it verbatim inside the imported model. Shortening the fixtures to
 * suit one downstream field would degrade the place the text was written for, so the cut happens
 * here, at the seam where catalogue form is translated into portal wire form.
 *
 * A non-string description is dropped rather than coerced: the connector documents are untyped
 * JSON, and a number or object in that slot is an authoring error, not a description.
 */
export function clampDescription(text: unknown): string | undefined {
    if (typeof text !== 'string') return undefined
    // The portal trims before it measures, so the clamp has to measure the same string.
    const trimmed = text.trim()
    if (trimmed.length <= DESCRIPTION_MAX_LENGTH) return trimmed

    // The ellipsis counts toward the limit — it is what tells the reader the text continues
    // somewhere (in the catalogue, and in the model's own description).
    const head = trimmed.slice(0, DESCRIPTION_MAX_LENGTH - 1)
    const lastSpace = head.lastIndexOf(' ')
    // Cutting mid-word reads like corruption; cutting at a word boundary reads like an excerpt.
    // A text with no space at all in that range has no boundary to honour and is cut hard.
    const cut = lastSpace > 0 ? head.slice(0, lastSpace) : head
    // Trailing punctuation before an ellipsis ("Kontext —…") reads like a typo.
    return `${cut.replace(/[\s,;:—–-]+$/u, '')}…`
}

/**
 * Provenance line for an imported structure version.
 *
 * The portal requires a version description once a version is AVAILABLE — and a bundle import
 * releases its structures — so leaving it empty parks every installed structure on a permanently
 * invalid form: the user cannot save any later edit without inventing a description for content
 * they did not write.
 *
 * The catalogue's own structure description is the wrong text to reuse: it describes the
 * structure, which the shell already carries, and it routinely exceeds the portal's field limit.
 * What a *version* description answers is where this version came from, so that is what it says —
 * short by construction, and true for every package.
 */
/**
 * Applies the user's broker URL to every bundled datasource that DECLARES
 * `urls` as an install parameter — and only to those. The manifest decides
 * which connector fields are instance-local; a blanket rewrite would let the
 * install dialog reach into fields the package never offered for override.
 */
export function applyDeclaredUrlOverride<
    T extends { document: Record<string, unknown>; parameters?: { field: string }[] },
>(dataSources: T[], brokerUrl: string): T[] {
    const url = brokerUrl.trim()
    if (!url) return dataSources
    return dataSources.map((source) =>
        source.parameters?.some((parameter) => parameter.field === 'urls')
            ? { ...source, document: { ...source.document, urls: [url] } }
            : source,
    )
}

export function versionProvenance(displayName: string, version: string): string {
    const line = `Aus Paket ${displayName} ${version}`
    if (line.length <= DESCRIPTION_MAX_LENGTH) {
        return line
    }
    // A pathologically long package name must not reintroduce the invalid-form state this
    // function exists to prevent: the version stays, the name gives way.
    const room = DESCRIPTION_MAX_LENGTH - `Aus Paket … ${version}`.length
    return `Aus Paket ${displayName.slice(0, Math.max(0, room))}… ${version}`
}
