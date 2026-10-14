import { CatalogFreshness } from '@/components/catalog/catalog-freshness'
import { UseCaseCatalog } from '@/components/catalog/use-case-catalog'
import { PageHeader } from '@/components/ui/layout'
import { getCatalogMeta, getCatalogSummaries } from '@/lib/catalog/source'
import type { FacetSelection } from '@/lib/catalog/facets'
import { fetchInstalledCatalogEntryIds } from '@/lib/installations'
import { requireSession } from '@/lib/session'
import { USE_CASE_FACETS } from '@/lib/use-case-catalog/facets'

/**
 * The use-case catalogue, laid out as in the clickdummy: title, one line on
 * what is listed here, freshness, then search, filters and the cards.
 *
 * Every facet reads its own URL parameter, so `?kategorie=umwelt-klima,energie-netze`
 * or `?q=baum` open the catalogue filtered.
 */
export default async function UseCasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    await requireSession()
    const [useCases, meta, installedIds, params] = await Promise.all([
        getCatalogSummaries('usecase'),
        getCatalogMeta(),
        // Which bundles are installed comes from the platform's provenance, not from
        // marketplace bookkeeping: the catalogue id is recorded on every install.
        fetchInstalledCatalogEntryIds(),
        searchParams,
    ])

    const initialFacets: FacetSelection = {}
    for (const facet of USE_CASE_FACETS) {
        const values = firstParam(params[facet.id])?.split(',').map((value) => value.trim()).filter(Boolean)
        if (values?.length) initialFacets[facet.id] = values
    }

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
            <div>
                <PageHeader
                    title="Anwendungsfälle"
                    lead="Fertige Lösungen für eine Aufgabe, in einem Schritt in dieser Instanz installierbar - samt Datenstrukturen, Pipelines, Karten und Dashboards. Dazu Praxisbeispiele, die anderswo laufen und hier beschrieben sind."
                />
                <div className="mt-2">
                    <CatalogFreshness meta={meta} />
                </div>
            </div>

            <UseCaseCatalog
                entries={useCases}
                installedIds={[...installedIds]}
                initialSearch={firstParam(params.q) ?? ''}
                initialFacets={initialFacets}
            />
        </div>
    )
}

function firstParam(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value
}
