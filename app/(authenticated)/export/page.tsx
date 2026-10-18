import Link from 'next/link'

import { ExportPanel } from '@/components/export/export-panel'
import { Disclosure } from '@/components/ui/disclosure'
import { PageHeader } from '@/components/ui/layout'
import { Notice } from '@/components/ui/notice'
import { exportConfig, exportReadiness } from '@/lib/export/config'
import { listDatasets, listExportInstallations, PortalReadError, type DatasetListing } from '@/lib/export/portal-reader'
import { getCatalogSummaries } from '@/lib/catalog/source'
import { exportSources } from '@/lib/export/sources'
import { draftOwnerTag } from '@/lib/export/share-drafts'
import { fetchShareRight, shareRefusal } from '@/lib/export/share-permission'
import { getAccessToken, requireSession } from '@/lib/session'

/** Whose drafts these are, as a tag; none without e-mail or name (see the panel's drafts). */
function draftOwner(user: { email?: string | null; name?: string | null } | undefined): string | undefined {
    const owner = user?.email?.trim() || user?.name?.trim()
    return owner ? draftOwnerTag(owner) : undefined
}

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
    const right = await fetchShareRight()
    const refusal = shareRefusal(right)
    const mayShare = !refusal

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
        installations.status === 'fulfilled' ? installations.value : undefined,
        catalog.status === 'fulfilled' ? catalog.value : [])

    return (
        <div className="flex flex-col gap-6">
            <PageHeader
                title="Teilen"
                lead="Wähle einen Use Case dieser Instanz aus, ergänze seinen Steckbrief und teile ihn mit anderen Kommunen."
                actions={
                    // The list of what was shared lives on its own page (Ewa, 2026-10-13).
                    <Link href="/export/shared" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                        Geteilte Pakete ansehen
                    </Link>
                }
            />

            {/* Neutral: setting it up is the operator's task, nothing the person here can supply. */}
            {readiness !== 'ready' && (
                <Notice tone="neutral" title="Teilen ist auf dieser Instanz noch nicht eingerichtet">
                    <p>
                        Die Vorschau funktioniert. Damit ein Paket vorgeschlagen werden kann, braucht die Instanz ein
                        Zielrepository und einen GitLab-Zugang - das richtet der Betrieb ein.
                    </p>
                    <Disclosure summary="Für den Betrieb" className="mt-1">
                        <p className="text-xs">
                            {readiness === 'missing-targets'
                                ? (config.targetsError ?? 'Kein Zielrepository konfiguriert: EXPORT_TARGET_REPOS setzen.')
                                : 'Kein GitLab-Zugang hinterlegt: EXPORT_REPO_TOKEN setzen.'}
                        </p>
                    </Disclosure>
                </Notice>
            )}

            {/* Neutral, not amber: amber asks for something the person can still supply, a right is not.
                The title claims a refusal only when there is one; an unreachable portal is not a "no". */}
            {readiness === 'ready' && refusal && (
                <Notice tone="neutral" title={right === 'refused' ? 'Teilen ist für dich nicht freigeschaltet' : undefined}>
                    {refusal}
                </Notice>
            )}

            {datasetsError ? (
                <Notice tone="error" title="Datensätze konnten nicht gelesen werden">
                    {datasetsError}
                </Notice>
            ) : (
                <ExportPanel
                    sources={sources}
                    sourceNotice={installations.status === 'rejected' || catalog.status === 'rejected' ? 'Katalogzuordnungen konnten nicht vollständig geladen werden. Teilen geht trotzdem - nur ohne vorbelegte Angaben aus dem Katalog.' : undefined}
                    targets={config.targets}
                    readiness={readiness}
                    mayShare={mayShare}
                    catalogUrl={config.catalog?.url}
                    defaults={{
                        publisher: 'openurbanapps',
                        // The name only: the maintainer goes into the public package.
                        maintainer: session.user?.name ?? '',
                    }}
                    // A tag, not the address: drafts are filed under it in the browser. Without
                    // e-mail or name there is nothing to keep two people apart, so no drafts.
                    draftOwner={draftOwner(session.user)}
                    canListShares={readiness === 'ready' && right === 'allowed'}
                />
            )}
        </div>
    )
}
