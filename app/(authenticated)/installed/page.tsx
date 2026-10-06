import { ReactivateDemoPanel } from '@/components/installed/reactivate-demo-panel'
import { SimulatorPanel } from '@/components/installed/simulator-panel'
import { UninstallButton } from '@/components/installed/uninstall-button'
import { partitionInstallations, readAllInstallations } from '@/lib/installation-list'
import { getAccessToken, requireSession } from '@/lib/session'
import { isSimulatorConfigured, listSimulations, type SimulationStatus } from '@/lib/simulator/client'
import { streamsOfInstallation } from '@/lib/simulator/registration'
import { simulatorUiUrl } from '@/lib/simulator/ui-links'

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
    /** The identity this instance minted for its copy. */
    urn?: string
    /** The identity the member carried inside the package it came from. */
    origin?: string
    action: 'CREATED' | 'REUSED' | string
}

interface InstallationRow {
    id: string
    createdAt: string
    /** Set when the installation was uninstalled; the record stays as history. */
    uninstalledAt?: string | null
    /** The id of the installed package: the catalogue id of the entry. */
    packageId?: string
    packageVersion?: string
    dataSetId?: string
    dataSetName?: string
    createdBy?: string
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

const NO_VALUE = '-'

const dateFormat = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin',
})

/**
 * The installation's simulator panel - or, when the registry holds no streams
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
    simulatorUiBase,
}: {
    simulations: SimulationStatus[]
    installationId: string
    catalogEntryId?: string
    hasDataSource: boolean
    simulatorUiBase?: string
}) {
    const streams = streamsOfInstallation(simulations, installationId)
    if (streams.length > 0) {
        return (
            <SimulatorPanel
                installationId={installationId}
                initialStreams={streams}
                simulatorUiUrl={simulatorUiBase}
            />
        )
    }
    if (!catalogEntryId || !hasDataSource) return null
    return <ReactivateDemoPanel installationId={installationId} catalogEntryId={catalogEntryId} />
}

/**
 * One installation: its header with the uninstall button or the time of the
 * uninstall, the simulator panel of an active installation, and one line per
 * artifact.
 */
function InstallationCard({
    installation,
    simulations,
    simulatorLive,
    simulatorUiBase,
}: {
    installation: InstallationRow
    simulations: SimulationStatus[]
    simulatorLive: boolean
    simulatorUiBase?: string
}) {
    return (
        <div className="overflow-hidden rounded-xl border bg-card">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b bg-muted/50 px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-medium text-foreground">
                        {installation.dataSetName ?? installation.packageId ?? NO_VALUE}
                    </span>
                    {installation.packageVersion && (
                        <span className="rounded bg-status-label px-1.5 py-0.5 text-xs">
                            v{installation.packageVersion}
                        </span>
                    )}
                    {installation.packageId && (
                        <span className="break-all text-xs text-muted-foreground">
                            {installation.packageId}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <div className="text-xs text-muted-foreground">
                        {dateFormat.format(new Date(installation.createdAt))}
                        {installation.createdBy && (
                            <span title={installation.createdBy}>
                                {' · von '}
                                {installation.createdBy.slice(0, 8)}
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
                    catalogEntryId={installation.packageId}
                    hasDataSource={installation.artifacts.some(
                        (artifact) => artifact.artifactType === 'DATA_SOURCE',
                    )}
                    simulatorUiBase={simulatorUiBase}
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
                            <tr key={`${installation.id}-${index}`} className="border-b last:border-0">
                                <td className="px-4 py-2 text-muted-foreground">
                                    {ARTIFACT_TYPE_LABELS[artifact.artifactType] ?? artifact.artifactType}
                                </td>
                                <td className="px-4 py-2 font-medium text-foreground">
                                    {artifact.name ?? NO_VALUE}
                                </td>
                                <td className="break-all px-4 py-2 text-xs text-muted-foreground">
                                    {artifact.urn ?? NO_VALUE}
                                    {artifact.origin && (
                                        <span className="mt-0.5 block text-muted-foreground/70">
                                            aus {artifact.origin}
                                        </span>
                                    )}
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
    )
}

/**
 * True marketplace installs, as the platform recorded them
 * (GET /v1/installations): which package, when, by whom, and what each install
 * created. Every artifact is a copy under an identity this instance minted;
 * the identity it carried in the package is kept as its origin. Both use-case
 * bundles and single data structures record an installation. Manually created
 * artifacts never show up here; the full instance inventory lives on
 * /instance.
 *
 * What is installed now comes first. An uninstalled installation stays in the
 * record and is shown below, folded, so that the history does not push the
 * active installations off the page.
 */
export default async function InstalledPage() {
    await requireSession()
    const accessToken = await getAccessToken()

    const list = await readAllInstallations<InstallationRow>(accessToken)

    if (!list.ok) {
        return (
            <div className="flex flex-col gap-6">
                <h1>Installiert</h1>
                <p className="rounded-lg border border-error/40 bg-error/5 dark:bg-error/15 px-4 py-3 text-sm text-error">
                    Backend antwortet mit {list.status} {list.statusText}
                    {list.status === 403 &&
                        '. Fehlt der Rolle die Berechtigung INSTALLATION_READ?'}
                </p>
            </div>
        )
    }

    const { active, history } = partitionInstallations(list.rows)

    // One registry snapshot serves every panel; the panels poll on their own
    // while open. An unreachable simulator degrades to no panels at all - the
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
    const simulatorUiBase = simulatorUiUrl()

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1>Installiert</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Über den Marketplace installierte Bundles, mit der Provenienz aus dem
                    Portal-Backend: wer hat wann was installiert, und was wurde dabei angelegt
                    oder wiederverwendet.
                </p>
            </div>

            {!list.isComplete && (
                <p className="rounded-lg border border-warn/40 bg-warn/5 px-4 py-3 text-sm text-warn">
                    Diese Instanz hat mehr Installationen, als die Seite lädt. Die ältesten
                    fehlen in der Liste.
                </p>
            )}

            {active.length === 0 ? (
                <p className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                    {history.length === 0
                        ? 'Noch nichts installiert.'
                        : 'Zurzeit ist nichts installiert.'}
                </p>
            ) : (
                active.map((installation) => (
                    <InstallationCard
                        key={installation.id}
                        installation={installation}
                        simulations={simulations}
                        simulatorLive={simulatorLive}
                        simulatorUiBase={simulatorUiBase}
                    />
                ))
            )}

            {history.length > 0 && (
                <details>
                    <summary className="cursor-pointer rounded-lg border bg-muted/50 px-4 py-3 text-sm font-medium text-foreground">
                        Verlauf: {history.length}{' '}
                        {history.length === 1
                            ? 'deinstallierte Installation'
                            : 'deinstallierte Installationen'}
                    </summary>
                    <div className="mt-6 flex flex-col gap-6">
                        {history.map((installation) => (
                            <InstallationCard
                                key={installation.id}
                                installation={installation}
                                simulations={simulations}
                                simulatorLive={simulatorLive}
                                simulatorUiBase={simulatorUiBase}
                            />
                        ))}
                    </div>
                </details>
            )}
        </div>
    )
}
