import { ArrowUpRight, Check } from 'lucide-react'

import { CatalogCard } from '@/components/catalog/catalog-card'
import { CatalogFreshness } from '@/components/catalog/catalog-freshness'
import { getCatalogMeta, getCatalogSummaries } from '@/lib/catalog/source'
import { catalogEntryHref } from '@/lib/use-case-catalog/path'
import { fetchInstalledCatalogEntryIds } from '@/lib/installations'
import { requireSession } from '@/lib/session'

export default async function UseCasesPage() {
    await requireSession()
    const useCases = await getCatalogSummaries('usecase')
    const meta = await getCatalogMeta()
    // Which bundles are installed comes from the platform's provenance, not from
    // marketplace bookkeeping — the catalogue id is recorded on every install.
    const installedIds = await fetchInstalledCatalogEntryIds()

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1>Use Cases</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Vollständige Anwendungsfälle: Datenmodell, Datenquellen und – künftig –
                    Pipeline und Dashboard, installierbar in einem Schritt. Dazu
                    Praxisbeispiele, die andernorts laufen und hier beschrieben sind.
                </p>
                <div className="mt-2">
                    <CatalogFreshness meta={meta} />
                </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {useCases.map((entry) => {
                    const installed = installedIds.has(entry.id)

                    return (
                        <CatalogCard
                            key={entry.id}
                            manifest={entry}
                            href={catalogEntryHref(entry.id)}
                            action={
                                !entry.deploymentRef && entry.implementation?.reference ? (
                                    <a
                                        href={entry.implementation.reference.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
                                    >
                                        {entry.implementation.reference.source ?? 'Zum Praxisbeispiel'}
                                        <ArrowUpRight className="size-4" />
                                    </a>
                                ) : undefined
                            }
                            badge={
                                installed ? (
                                    <span className="inline-flex items-center gap-1 rounded-md bg-success/10 dark:bg-success/20 px-2 py-1 text-xs font-medium text-success">
                                        <Check className="size-3.5" />
                                        Bereits installiert
                                    </span>
                                ) : undefined
                            }
                        />
                    )
                })}
            </div>
        </div>
    )
}
