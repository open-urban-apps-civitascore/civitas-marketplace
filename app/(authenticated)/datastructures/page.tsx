import { Check } from 'lucide-react'

import { CatalogCard } from '@/components/catalog/catalog-card'
import { CatalogFreshness } from '@/components/catalog/catalog-freshness'
import { InstallButton } from '@/components/catalog/install-button'
import { getCatalogMeta, getCatalogSummaries } from '@/lib/catalog/source'
import { fetchInstalledCatalogEntryIds } from '@/lib/installations'
import { requireSession } from '@/lib/session'

export default async function DataStructuresCatalogPage() {
    await requireSession()
    const structures = await getCatalogSummaries('datastructure')
    const meta = await getCatalogMeta()
    const installedIds = await fetchInstalledCatalogEntryIds()

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1>Datenstrukturen</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Wiederverwendbare Fachmodelle — einzeln installierbar und von mehreren Use
                    Cases gemeinsam nutzbar.
                </p>
                <div className="mt-2">
                    <CatalogFreshness meta={meta} />
                </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {structures.map((entry) => {
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
