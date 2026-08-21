import { Check } from 'lucide-react'

import { CatalogCard } from '@/components/catalog/catalog-card'
import { CatalogFreshness } from '@/components/catalog/catalog-freshness'
import { InstallButton } from '@/components/catalog/install-button'
import { getCatalogMeta, getCatalogSummaries } from '@/lib/catalog/source'
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
                    Pipeline und Dashboard, installierbar in einem Schritt.
                </p>
                <div className="mt-2">
                    <CatalogFreshness meta={meta} />
                </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {useCases.map((entry) => {
                    const installed = installedIds.has(entry.id)

                    return (
                        <CatalogCard
                            key={entry.id}
                            manifest={entry}
                            action={<InstallButton entryId={entry.id} installed={installed} />}
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
