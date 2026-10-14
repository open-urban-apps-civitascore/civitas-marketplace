import { matchesQuery } from '@/lib/catalog/search'

/**
 * How a facet narrows the list. The mode is a property of the DATA, not of the
 * UI — picking the wrong one produces a filter that lies about what it does.
 *
 * - `multi` — categorical, several values allowed, OR within the facet.
 *   An entry can carry several categories, and "Umwelt or Mobilität" is the
 *   question people actually ask. The default.
 * - `ordinal` — an ordered scale where choosing a value means "at most this".
 *   Cost and effort bands: the label already says „unter 10.000 €", so an
 *   entry costing under 1.000 € has to match it. Exact equality here made the
 *   filter contradict its own label (found 2026-09-23).
 * - `toggle` — a yes/no property. One option, on or off.
 */
export type FacetMode = 'multi' | 'ordinal' | 'toggle'

export interface FacetDef<T> {
    /** Stable key — ALSO the URL parameter name. */
    id: string
    /** German heading on the dropdown. */
    label: string
    /** Values this entry has for the facet — several for multi-valued facets. */
    valuesOf: (entry: T) => string[]
    /** Display label for a raw value, e.g. a band code → "M — unter 10.000 €". */
    labelOf?: (value: string) => string
    /**
     * Fixed option order; derived and sorted when absent.
     * REQUIRED for `ordinal`, where the order IS the scale (low → high).
     */
    options?: readonly string[]
    /**
     * Offer EVERY declared option, also those no entry carries yet — they show
     * 0 and stay disabled. Only for a fixed public scale whose full extent is
     * itself the message: the status scale tells a reader that ideas and
     * concepts belong in this catalog before the first one is listed (feedback
     * 2026-10-12). Whether the facet is rendered at all still follows the data,
     * see `isUsefulFacet`.
     */
    showAllOptions?: boolean
    mode?: FacetMode
    /** `"more"` sorts the facet later in the bar; nothing is hidden. */
    group?: 'primary' | 'more'
}

/** facet id → selected values. An empty or missing array means "Alle". */
export type FacetSelection = Record<string, string[]>

export interface CatalogFilterState {
    search: string
    facets: FacetSelection
}

export const EMPTY_FILTER_STATE: CatalogFilterState = { search: '', facets: {} }

export const facetMode = <T,>(def: FacetDef<T>): FacetMode => def.mode ?? 'multi'

/** The options offered for a facet: the declared order, or derived and sorted. */
export function facetOptions<T>(def: FacetDef<T>, entries: T[]): string[] {
    if (def.options && def.showAllOptions) return [...def.options]
    return presentOptions(def, entries)
}

/** Only the values some entry actually carries. */
function presentOptions<T>(def: FacetDef<T>, entries: T[]): string[] {
    const present = new Set(entries.flatMap((entry) => def.valuesOf(entry)))
    if (def.options) {
        // Keep the declared order, but only offer what the data contains — a band
        // nobody used is a dead end in the UI.
        return def.options.filter((option) => present.has(option))
    }
    return Array.from(present).sort((a, b) => a.localeCompare(b, 'de'))
}

/** Does one entry satisfy one facet's current selection? */
export function matchesFacet<T>(def: FacetDef<T>, entry: T, selected: string[]): boolean {
    if (selected.length === 0) return true

    const values = def.valuesOf(entry)

    if (facetMode(def) === 'ordinal') {
        // "at most the chosen step". The scale is the declared `options` order;
        // without it there is no scale, so fall back to exact matching.
        const scale = def.options
        if (!scale) return selected.some((value) => values.includes(value))

        const ceiling = Math.max(...selected.map((value) => scale.indexOf(value)))
        return values.some((value) => {
            const index = scale.indexOf(value)
            return index !== -1 && index <= ceiling
        })
    }

    // multi and toggle are both "entry carries any of the selected values".
    return selected.some((value) => values.includes(value))
}

export function matchesFacets<T>(
    entry: T,
    defs: FacetDef<T>[],
    selection: FacetSelection,
): boolean {
    return defs.every((def) => matchesFacet(def, entry, selection[def.id] ?? []))
}

export const activeFacetCount = (selection: FacetSelection): number =>
    Object.values(selection).filter((values) => values.length > 0).length

/**
 * Is this facet worth showing at all?
 *
 * A facet whose every entry carries the same single value cannot narrow the
 * list — selecting it returns everything. That is dead UI, and it was visible:
 * all catalog use cases install "Über das Portal", so the Installationsweg
 * facet offered exactly one pill that changed nothing (Ewa, 2026-09-23).
 *
 * The second condition is NOT redundant: a single option still narrows when
 * some entries lack the value entirely, so only the all-entries-share-it case
 * is suppressed.
 *
 * Judged on the values present, also for `showAllOptions`: a scale where every
 * entry sits on the same step would otherwise render one live option among
 * greyed-out ones, a control that still changes nothing.
 */
export function isUsefulFacet<T>(def: FacetDef<T>, entries: T[]): boolean {
    const options = presentOptions(def, entries)
    if (options.length === 0) return false
    if (options.length > 1) return true
    return entries.filter((entry) => def.valuesOf(entry).includes(options[0]!)).length < entries.length
}

// ── Counting ────────────────────────────────────────────────────────────────

/**
 * The entries a facet's own option counts must be measured against: everything
 * filtered EXCEPT that facet itself.
 *
 * This is the standard faceted-search rule and the fix for a genuinely
 * misleading UI (Ewa, 2026-09-23): counts used to be taken over the whole
 * catalog, so with „Siegel: Verifiziert" already active, „Themengebiet ·
 * Umwelt 2" still promised two results while the actual answer was one.
 *
 * A facet is excluded from its own base set so that its other options stay
 * selectable — otherwise choosing one value would drive every sibling option
 * to zero and the filter would become a dead end.
 */
export function baseEntriesForFacet<T>({
    entries,
    facets,
    state,
    index,
    keyOf,
    exceptFacetId,
}: {
    entries: T[]
    facets: FacetDef<T>[]
    state: CatalogFilterState
    index: Map<string, string>
    keyOf: (entry: T) => string
    exceptFacetId: string
}): T[] {
    const query = state.search.trim()
    const others = facets.filter((facet) => facet.id !== exceptFacetId)

    return entries.filter((entry) => {
        if (query && !matchesQuery(index.get(keyOf(entry)) ?? '', query)) return false
        return others.every((facet) => matchesFacet(facet, entry, state.facets[facet.id] ?? []))
    })
}

/**
 * How many entries each option would leave, given the other active filters.
 * For an `ordinal` facet this is cumulative, matching what selecting it does.
 */
export function facetOptionCounts<T>(
    def: FacetDef<T>,
    baseEntries: T[],
    /**
     * The options actually rendered — derived from ALL entries, not from the
     * base set. Passing them explicitly is what lets an option that is currently
     * unreachable report 0 instead of dropping out of the map: the dropdown
     * still shows it, so it still needs a number.
     */
    options: string[],
): Map<string, number> {
    const counts = new Map<string, number>()
    for (const option of options) {
        counts.set(option, baseEntries.filter((entry) => matchesFacet(def, entry, [option])).length)
    }
    return counts
}

/** Search + facets in one pass. Pure, so the catalogs stay thin. */
export function applyCatalogFilters<T>({
    entries,
    facets,
    state,
    index,
    keyOf,
}: {
    entries: T[]
    facets: FacetDef<T>[]
    state: CatalogFilterState
    index: Map<string, string>
    keyOf: (entry: T) => string
}): T[] {
    const query = state.search.trim()
    return entries.filter((entry) => {
        if (query && !matchesQuery(index.get(keyOf(entry)) ?? '', query)) return false
        return matchesFacets(entry, facets, state.facets)
    })
}
