import { Check } from 'lucide-react'

import { CatalogCard } from '@/components/catalog/catalog-card'
import { InstallButton } from '@/components/catalog/install-button'
import { fetchInstalledCatalogEntryIds } from '@/lib/installations'
import { mockCatalog } from '@/lib/mock-catalog'
import { requireSession } from '@/lib/session'

export default async function DataStructuresCatalogPage() {
    await requireSession()
    const structures = mockCatalog.filter((entry) => entry.manifest.type === 'datastructure')
    const installedIds = await fetchInstalledCatalogEntryIds()

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1>Datenstrukturen</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Wiederverwendbare Fachmodelle — einzeln installierbar und von mehreren Use
                    Cases gemeinsam nutzbar.
                </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {structures.map((entry) => {
                    const installed = installedIds.has(entry.manifest.id)

                    return (
                        <CatalogCard
                            key={entry.manifest.id}
                            manifest={entry.manifest}
                            action={
                                <InstallButton
                                    entryId={entry.manifest.id}
                                    installed={installed}
                                />
                            }
                            badge={
                                installed ? (
                                    <span className="inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-1 text-xs font-medium text-success">
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
