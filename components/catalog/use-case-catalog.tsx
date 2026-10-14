'use client'

import { useMemo, useState } from 'react'

import { CatalogFilters } from '@/components/catalog/catalog-filters'
import { UseCaseCard } from '@/components/catalog/use-case-card'
import { applyCatalogFilters, type CatalogFilterState, type FacetSelection } from '@/lib/catalog/facets'
import { buildSearchIndex } from '@/lib/catalog/search'
import type { CatalogSummary } from '@/lib/catalog/types'
import { USE_CASE_FACETS, useCaseSearchText } from '@/lib/use-case-catalog/facets'
import { catalogEntryHref } from '@/lib/use-case-catalog/path'

const keyOf = (entry: CatalogSummary) => entry.id

/**
 * The use-case catalogue as the clickdummy shows it: search and filters on
 * one bar, the result count, the cards. Filtering runs in the browser, over
 * the rows the page already has: the whole catalogue is one index file.
 *
 * `initialFacets` comes from the address (`?kategorie=umwelt-klima`), so a
 * link can open the catalogue filtered; filtering does not write it back.
 */
export function UseCaseCatalog({
    entries,
    installedIds,
    initialSearch = '',
    initialFacets = {},
}: {
    entries: CatalogSummary[]
    /** Catalogue ids already installed in this instance. */
    installedIds: string[]
    initialSearch?: string
    initialFacets?: FacetSelection
}) {
    const [filters, setFilters] = useState<CatalogFilterState>({ search: initialSearch, facets: initialFacets })
    const installed = useMemo(() => new Set(installedIds), [installedIds])

    // Built once per list, not per keystroke: typing then costs one substring
    // check per word per entry instead of a walk over nested objects.
    const index = useMemo(() => buildSearchIndex(entries, keyOf, useCaseSearchText), [entries])
    const shown = useMemo(
        () => applyCatalogFilters({ entries, facets: USE_CASE_FACETS, state: filters, index, keyOf }),
        [entries, filters, index],
    )

    return (
        <div className="flex flex-col gap-6">
            <CatalogFilters
                value={filters}
                onChange={setFilters}
                facets={USE_CASE_FACETS}
                entries={entries}
                searchIndex={index}
                keyOf={keyOf}
                searchPlaceholder="Anwendungsfall suchen …"
            />

            <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{shown.length}</span> von {entries.length}
            </p>

            {shown.length > 0 ? (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {shown.map((entry) => (
                        <UseCaseCard key={entry.id} entry={entry} href={catalogEntryHref(entry.id)} installed={installed.has(entry.id)} />
                    ))}
                </div>
            ) : (
                <div className="rounded-lg border border-dashed bg-card p-12 text-center text-sm text-muted-foreground">
                    {entries.length === 0
                        ? 'Der Katalog enthält noch keine Anwendungsfälle.'
                        : 'Keine Anwendungsfälle für die aktuelle Suche gefunden.'}
                </div>
            )}
        </div>
    )
}
