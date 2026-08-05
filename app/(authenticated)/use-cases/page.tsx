import { CatalogCard } from '@/components/catalog/catalog-card'
import { InstallButton } from '@/components/catalog/install-button'
import { mockCatalog } from '@/lib/mock-catalog'
import { requireSession } from '@/lib/session'

export default async function UseCasesPage() {
    await requireSession()
    const useCases = mockCatalog.filter((entry) => entry.manifest.type === 'usecase')

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1>Use Cases</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Vollständige Anwendungsfälle: Datenmodell, Datenquellen und – künftig –
                    Pipeline und Dashboard, installierbar in einem Schritt.
                </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {useCases.map((entry) => (
                    <CatalogCard
                        key={entry.manifest.id}
                        manifest={entry.manifest}
                        action={<InstallButton entryId={entry.manifest.id} />}
                    />
                ))}
            </div>
        </div>
    )
}
