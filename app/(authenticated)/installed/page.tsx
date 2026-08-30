import { ReactivateDemoPanel } from '@/components/installed/reactivate-demo-panel'
import { SimulatorPanel } from '@/components/installed/simulator-panel'
import { UninstallButton } from '@/components/installed/uninstall-button'
import { getAccessToken, requireSession } from '@/lib/session'
import { isSimulatorConfigured, listSimulations, type SimulationStatus } from '@/lib/simulator/client'
import { streamsOfInstallation } from '@/lib/simulator/registration'

interface InstalledArtifactRow {
    artifactType:
        | 'DATA_STRUCTURE'
        | 'DATA_SOURCE'
        | 'MAPPING'
        | 'DATA_SET'
        | 'DATA_SINK'
        | 'PIPELINE'
        | string
    name?: string
    shellId?: string
    urn?: string
    action: 'CREATED' | 'REUSED' | string
}

interface InstallationRow {
    id: string
    createdAt: string
    /** Set when the installation was uninstalled; the record stays as history. */
    uninstalledAt?: string | null
    catalogEntryId?: string
    catalogEntryVersion?: string
    dataSetId?: string
    dataSetName?: string
    installedBy?: string
    artifacts: InstalledArtifactRow[]
}

const ARTIFACT_TYPE_LABELS: Record<string, string> = {
    DATA_STRUCTURE: 'Datenstruktur',
    DATA_SOURCE: 'Datenquelle',
    MAPPING: 'Mapping',
    DATA_SET: 'Dataset',
    DATA_SINK: 'Datensenke',
    PIPELINE: 'Pipeline',
}

const ACTION_LABELS: Record<string, string> = {
    CREATED: 'neu angelegt',
    REUSED: 'wiederverwendet',
}

const dateFormat = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin',
})

/**
 * The installation's simulator panel — or, when the registry holds no streams
 * for an installation that could have them, the one-click reactivation row
 * (the state a simulator restart leaves behind). A DATA_SOURCE artifact is the
 * cheap tell for "could have them": demo streams publish into a datasource, so
 * structure-only installs never show the row.
 */
function InstallationSimulator({
    simulations,
    installationId,
    catalogEntryId,
    hasDataSource,
}: {
    simulations: SimulationStatus[]
    installationId: string
    catalogEntryId?: string
    hasDataSource: boolean
}) {
    const streams = streamsOfInstallation(simulations, installationId)
    if (streams.length > 0) {
        return <SimulatorPanel installationId={installationId} initialStreams={streams} />
    }
    if (!catalogEntryId || !hasDataSource) return null
    return <ReactivateDemoPanel installationId={installationId} catalogEntryId={catalogEntryId} />
}

/**
 * True marketplace installs — the backend's install provenance
 * (GET /v1/installations): which catalogue entry, when, by whom, and what each
 * install created or reused. Both use-case bundles and single data structures
 * record one. Manually created artifacts never show up here; the full instance
 * inventory lives on /instance.
 */
export default async function InstalledPage() {
    await requireSession()
    const accessToken = await getAccessToken()

    const res = await fetch(
        `${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/installations`,
        {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: 'no-store',
        },
    )

    if (!res.ok) {
        return (
            <div className="flex flex-col gap-6">
                <h1>Installiert</h1>
                <p className="rounded-lg border border-error/40 bg-error/5 dark:bg-error/15 px-4 py-3 text-sm text-error">
                    Backend antwortet mit {res.status} {res.statusText}
                    {res.status === 403 &&
                        ' — fehlt der Rolle die Berechtigung INSTALLATION_READ?'}
                </p>
            </div>
        )
    }

    const page = (await res.json()) as { content?: InstallationRow[]; totalElements?: number }
    const installations = page.content ?? []

    // One registry snapshot serves every panel; the panels poll on their own
    // while open. An unreachable simulator degrades to no panels at all — the
    // same demo-day-safe default as the unset SIMULATOR_API_URL. The empty
    // registry of a REACHABLE simulator is a different state: that is the
    // restart case the reactivation row exists for, so the two must not blur.
    let simulations: SimulationStatus[] = []
    let simulatorLive = false
    if (isSimulatorConfigured()) {
        try {
            simulations = await listSimulations()
            simulatorLive = true
        } catch {
            // degrade to no panels
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1>Installiert</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Über den Marketplace installierte Bundles — Provenienz aus dem
                    Portal-Backend: wer hat wann was installiert, und was wurde dabei angelegt
                    oder wiederverwendet.
                </p>
            </div>

            {installations.length === 0 ? (
                <p className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                    Noch nichts installiert.
                </p>
            ) : (
                installations.map((installation) => (
                    <div
                        key={installation.id}
                        className="overflow-hidden rounded-xl border bg-card"
                    >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b bg-muted/50 px-4 py-3">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                <span className="font-medium text-foreground">
                                    {installation.dataSetName ?? installation.catalogEntryId ?? '—'}
                                </span>
                                {installation.catalogEntryVersion && (
                                    <span className="rounded bg-status-label px-1.5 py-0.5 text-xs">
                                        v{installation.catalogEntryVersion}
                                    </span>
                                )}
                                {installation.catalogEntryId && (
                                    <span className="break-all text-xs text-muted-foreground">
                                        {installation.catalogEntryId}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="text-xs text-muted-foreground">
                                    {dateFormat.format(new Date(installation.createdAt))}
                                    {installation.installedBy && (
                                        <span title={installation.installedBy}>
                                            {' · von '}
                                            {installation.installedBy.slice(0, 8)}
                                        </span>
                                    )}
                                </div>
                                {installation.uninstalledAt ? (
                                    <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                                        Deinstalliert{' '}
                                        {dateFormat.format(new Date(installation.uninstalledAt))}
                                    </span>
                                ) : (
                                    <UninstallButton installationId={installation.id} />
                                )}
                            </div>
                        </div>

                        {!installation.uninstalledAt && simulatorLive && (
                            <InstallationSimulator
                                simulations={simulations}
                                installationId={installation.id}
                                catalogEntryId={installation.catalogEntryId}
                                hasDataSource={installation.artifacts.some(
                                    (artifact) => artifact.artifactType === 'DATA_SOURCE',
                                )}
                            />
                        )}

                        {/* URNs are wide; on narrow screens the table scrolls inside
                            its own container instead of stretching the page. */}
                        <div className="overflow-x-auto">
                        <table className="w-full min-w-[40rem] text-sm">
                            <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-2 font-medium">Typ</th>
                                    <th className="px-4 py-2 font-medium">Name</th>
                                    <th className="px-4 py-2 font-medium">URN</th>
                                    <th className="px-4 py-2 font-medium">Aktion</th>
                                </tr>
                            </thead>
                            <tbody>
                                {installation.artifacts.map((artifact, index) => (
                                    <tr
                                        key={`${installation.id}-${index}`}
                                        className="border-b last:border-0"
                                    >
                                        <td className="px-4 py-2 text-muted-foreground">
                                            {ARTIFACT_TYPE_LABELS[artifact.artifactType] ??
                                                artifact.artifactType}
                                        </td>
                                        <td className="px-4 py-2 font-medium text-foreground">
                                            {artifact.name ?? '—'}
                                        </td>
                                        <td className="break-all px-4 py-2 text-xs text-muted-foreground">
                                            {artifact.urn ?? '—'}
                                        </td>
                                        <td className="px-4 py-2">
                                            <span
                                                className={
                                                    artifact.action === 'CREATED'
                                                        ? 'rounded bg-success/10 dark:bg-success/20 px-1.5 py-0.5 text-xs text-success'
                                                        : 'rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'
                                                }
                                            >
                                                {ACTION_LABELS[artifact.action] ?? artifact.action}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        </div>
                    </div>
                ))
            )}
        </div>
    )
}
