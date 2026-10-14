/**
 * The front page's "Im Katalog": one column per catalogue section, each with
 * its total and a preview of three entries (the clickdummy's "Zuletzt
 * hinzugefügt", lib/recently-added.ts).
 *
 * Not called "zuletzt hinzugefügt" here: the catalogue carries no dates yet.
 * What it does have is order: a shared entry is appended to its section of
 * the index (lib/export/catalog-entry) and updated in place, so the end of a
 * section is what arrived last. The preview shows that end, newest first, and
 * claims nothing beyond "in the catalogue".
 */

export type CatalogKind = 'use-case' | 'addon' | 'data-structure'

/** One row of a preview, normalised across the three entry shapes. */
export interface CatalogHighlight {
    id: string
    title: string
    /** What it is, in one line. */
    summary: string
    /** Who stands behind it: publisher, maintainer or author. */
    meta: string
    href: string
}

export interface CatalogKindPreview {
    kind: CatalogKind
    label: string
    href: string
    /** How many entries the section holds, not just the preview. */
    total: number
    entries: CatalogHighlight[]
}

/** The last `count` entries of a section, last first. */
export function newestFirst<T>(entries: T[], count = 3): T[] {
    return entries.slice(-count).reverse()
}

export function catalogPreview(kind: CatalogKind, label: string, href: string, entries: CatalogHighlight[], count = 3): CatalogKindPreview {
    return { kind, label, href, total: entries.length, entries: newestFirst(entries, count) }
}
