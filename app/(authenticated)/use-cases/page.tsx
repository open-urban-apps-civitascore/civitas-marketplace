import { ArrowUpRight, Check } from 'lucide-react'

import { CatalogCard } from '@/components/catalog/catalog-card'
import { CatalogFreshness } from '@/components/catalog/catalog-freshness'
import { InstallDialog } from '@/components/catalog/install-dialog'
import { SamplePreview } from '@/components/catalog/sample-preview'
import { getCatalogMeta, getCatalogSummaries } from '@/lib/catalog/source'
import { fetchInstalledCatalogEntryIds } from '@/lib/installations'
import { requireSession } from '@/lib/session'
import { isSimulatorConfigured } from '@/lib/simulator/client'

export default async function UseCasesPage() {
    await requireSession()
    const useCases = await getCatalogSummaries('usecase')
    const meta = await getCatalogMeta()
    // Which bundles are installed comes from the platform's provenance, not from
    // marketplace bookkeeping — the catalogue id is recorded on every install.
    const installedIds = await fetchInstalledCatalogEntryIds()
    // Sample preview needs the in-cluster simulator; without it the button
    // simply does not render.
    const previewAvailable = isSimulatorConfigured()

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
                            action={
                                <div className="flex flex-wrap items-start gap-2">
                                    {/* Installability is decided by the pin and nothing else.
                                        A described entry documents an implementation running
                                        elsewhere — offering it an install button would promise
                                        something the catalogue cannot deliver. */}
                                    {entry.deploymentRef ? (
                                        <>
                                            <InstallDialog
                                                entryId={entry.id}
                                                displayName={entry.displayName}
                                                version={entry.version}
                                                installed={installed}
                                                demoAvailable={previewAvailable}
                                            />
                                            {previewAvailable && <SamplePreview entryId={entry.id} />}
                                        </>
                                    ) : (
                                        entry.implementation?.reference && (
                                            <a
                                                href={entry.implementation.reference.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
                                            >
                                                {entry.implementation.reference.source ??
                                                    'Zum Praxisbeispiel'}
                                                <ArrowUpRight className="size-4" />
                                            </a>
                                        )
                                    )}
                                </div>
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
