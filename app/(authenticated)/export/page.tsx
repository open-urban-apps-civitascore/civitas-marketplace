import { ExportPanel } from '@/components/export/export-panel'
import { SharedPackages } from '@/components/export/shared-packages'
import { exportConfig, exportReadiness } from '@/lib/export/config'
import { listDatasets, listExportInstallations, PortalReadError, type DatasetListing } from '@/lib/export/portal-reader'
import { getCatalogSummaries } from '@/lib/catalog/source'
import { exportSources } from '@/lib/export/sources'
import { getAccessToken, requireSession } from '@/lib/session'

/**
 * Sharing starts at the instance's INVENTORY, not at an installation: what a
 * municipality wants to hand on is usually what it modelled by hand in the
 * portal, and no install record exists for that. Every dataset the signed-in
 * user may read is offered; the platform's own permissions decide, the
 * marketplace adds none.
 */
export default async function ExportPage() {
    const session = await requireSession()
    const accessToken = await getAccessToken()
    const config = exportConfig()
    const readiness = exportReadiness(config)

    let datasets: DatasetListing[] = []
    let datasetsError: string | undefined
    try {
        datasets = await listDatasets(accessToken)
    } catch (error) {
        datasetsError = error instanceof PortalReadError ? error.message : String(error)
    }

    const [installations, catalog] = await Promise.allSettled([
        listExportInstallations(accessToken), getCatalogSummaries('usecase'),
    ])
    const sources = exportSources(datasets,
        installations.status === 'fulfilled' ? installations.value : [],
        catalog.status === 'fulfilled' ? catalog.value : [])

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1>Teilen</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Wähle einen Use Case dieser Instanz aus, ergänze seinen Steckbrief und teile ihn mit anderen Kommunen.
                </p>
            </div>

            {readiness !== 'ready' && (
                <p className="rounded-lg border border-warn/40 bg-warn/5 px-4 py-3 text-sm text-warn dark:bg-warn/15">
                    {readiness === 'missing-targets'
                        ? (config.targetsError ??
                          'Kein Zielrepository konfiguriert (EXPORT_TARGET_REPOS) - die Vorschau funktioniert, ein Merge Request nicht.')
                        : 'Kein GitLab-Zugang hinterlegt (EXPORT_REPO_TOKEN) - die Vorschau funktioniert, ein Merge Request nicht.'}
                </p>
            )}

            {datasetsError ? (
                <p className="rounded-lg border border-error/40 bg-error/5 px-4 py-3 text-sm text-error dark:bg-error/15">
                    Datasets konnten nicht gelesen werden: {datasetsError}
                </p>
            ) : (
                <ExportPanel
                    sources={sources}
                    sourceNotice={installations.status === 'rejected' || catalog.status === 'rejected' ? 'Katalogzuordnungen konnten nicht vollständig geladen werden. Du kannst lokale Use Cases trotzdem teilen.' : undefined}
                    targets={config.targets}
                    readiness={readiness}
                    catalogUrl={config.catalog?.url}
                    defaults={{
                        publisher: 'openurbanapps',
                        maintainer: session.user?.name ?? session.user?.email ?? '',
                    }}
                />
            )}

            {/* The way back after a merge: the catalogue step from here needs no form. */}
            {readiness === 'ready' && <SharedPackages />}
        </div>
    )
}
