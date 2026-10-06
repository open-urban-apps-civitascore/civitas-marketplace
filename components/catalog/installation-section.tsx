import Link from 'next/link'
import {
    ArrowUpRight,
    Database,
    FolderOpen,
    LayoutDashboard,
    Radio,
    TriangleAlert,
    type LucideIcon,
} from 'lucide-react'

import { ReimportDashboardsButton } from '@/components/catalog/reimport-dashboards-button'
import { UninstallButton } from '@/components/installed/uninstall-button'
import type { DatasetOverview } from '@/lib/datapool-of-dataset'
import type { InstalledDashboardLink } from '@/lib/installed-dashboards'
import type { ActiveInstallation } from '@/lib/installations'
import { datapoolHref, datasetHref } from '@/lib/portal-links'
import type { InstallationStream } from '@/lib/simulator/registration'
import { simulationUiHref } from '@/lib/simulator/ui-links'
import { uninstallBlocker } from '@/lib/uninstall-blocker'

const DATASET_STATUS_LABELS: Record<string, string> = {
    DRAFT: 'Entwurf',
    READY: 'Bereit zur Freigabe',
    AVAILABLE: 'Freigegeben',
}

/**
 * What an installed use case is in THIS instance, below the catalogue's
 * description of it. The hero above answers "should we install this?"; this
 * card answers "what runs now, and how do I reach, maintain or remove it?",
 * so it only exists for an installed entry.
 *
 * Three parts, in the order of how often they are needed: links into the
 * systems the installation lives in (portal, Superset, simulator), the
 * maintenance actions, and, set apart at the bottom, the removal.
 *
 * `streams` is null when the simulator is not configured or not reachable,
 * an empty list when it is reachable and holds none for this installation.
 */
export function InstallationSection({
    installation,
    dataset,
    dashboards,
    streams,
    simulatorUiBase,
}: {
    installation: ActiveInstallation
    dataset: DatasetOverview | null
    dashboards: InstalledDashboardLink[]
    streams: InstallationStream[] | null
    simulatorUiBase?: string
}) {
    const blocker = uninstallBlocker(dataset)
    const released = dataset?.status === 'AVAILABLE'
    const streamLinks = simulatorUiBase ? (streams ?? []) : []
    // The restart case of the installed page: a reachable simulator without
    // streams for an installation that could have them.
    const demoMissing = streams !== null && streams.length === 0 && installation.hasDataSource
    const dataSetName = installation.dataSetName ?? 'Datensatz'

    const hasLinks =
        Boolean(installation.dataSetId) ||
        Boolean(dataset?.datapool) ||
        dashboards.length > 0 ||
        streamLinks.length > 0

    return (
        <section aria-labelledby="installation-heading" className="overflow-hidden rounded-md border bg-card">
            <div className="border-b px-6 py-4">
                <h2 id="installation-heading" className="text-lg font-semibold text-foreground">
                    In dieser Instanz
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                    Was die Installation angelegt hat und wo es läuft.
                </p>
            </div>

            <div className="flex flex-col gap-6 px-6 py-5">
                {dataset?.status && (
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className="text-muted-foreground">Datensatz</span>
                        <span
                            className={
                                released
                                    ? 'rounded-md bg-success/10 px-2 py-0.5 text-xs font-medium text-success dark:bg-success/20'
                                    : 'rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
                            }
                        >
                            {DATASET_STATUS_LABELS[dataset.status] ?? dataset.status}
                        </span>
                        {!released && (
                            <span className="text-muted-foreground">
                                Daten fließen erst nach der Freigabe im Portal.
                                {dashboards.length > 0 && ' Bis dahin meldet das Dashboard eine fehlende Tabelle.'}
                            </span>
                        )}
                    </p>
                )}

                {(hasLinks || demoMissing) && (
                    <Group label="Öffnen">
                        {hasLinks && (
                            <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border">
                                {installation.dataSetId && (
                                    <OpenRow
                                        icon={Database}
                                        kind="Datensatz"
                                        name={dataSetName}
                                        href={datasetHref(installation.dataSetId)}
                                        target="Portal"
                                    />
                                )}
                                {dataset?.datapool && (
                                    <OpenRow
                                        icon={FolderOpen}
                                        kind="Datenpool"
                                        name={dataset.datapool.name}
                                        href={datapoolHref(dataset.datapool.id)}
                                        target="Portal"
                                    />
                                )}
                                {dashboards.map((dashboard) => (
                                    <OpenRow
                                        key={dashboard.url}
                                        icon={LayoutDashboard}
                                        kind="Dashboard"
                                        name={dashboard.title}
                                        href={dashboard.url}
                                        target="Superset"
                                    />
                                ))}
                                {simulatorUiBase &&
                                    streamLinks.map(({ streamName, status }) => (
                                        <OpenRow
                                            key={status.id}
                                            icon={Radio}
                                            kind="Demo-Stream"
                                            name={streamName}
                                            href={simulationUiHref(simulatorUiBase, status.id)}
                                            target="Simulator"
                                        >
                                            <span
                                                className={
                                                    status.enabled
                                                        ? 'shrink-0 rounded bg-success/10 px-1.5 py-0.5 text-xs text-success dark:bg-success/20'
                                                        : 'shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'
                                                }
                                            >
                                                {status.enabled ? 'Aktiv' : 'Pausiert'}
                                            </span>
                                        </OpenRow>
                                    ))}
                            </ul>
                        )}
                        {demoMissing && (
                            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                Für diese Installation laufen keine Demo-Daten, zum Beispiel nach einem
                                Neustart des Simulators.{' '}
                                <Link
                                    href="/installed"
                                    className="font-medium text-primary underline-offset-2 hover:underline"
                                >
                                    Unter „Installiert“ einschalten
                                </Link>
                            </p>
                        )}
                    </Group>
                )}

                {dashboards.length > 0 && (
                    <Group label="Pflege">
                        <div className="mt-2">
                            <ReimportDashboardsButton installationId={installation.id} />
                        </div>
                    </Group>
                )}
            </div>

            <div className="flex flex-col gap-3 border-t bg-muted/20 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1 text-xs leading-relaxed">
                    {blocker ? (
                        <div role="note" className="flex gap-2 text-warn">
                            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                            <p>
                                <span className="font-medium">{blocker.reason}</span> {blocker.remedy}
                                {blocker.warning && <> {blocker.warning}</>}
                                {installation.dataSetId && (
                                    <>
                                        {' '}
                                        <a
                                            href={datasetHref(installation.dataSetId)}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-0.5 font-medium underline-offset-2 hover:underline"
                                        >
                                            Datensatz im Portal öffnen
                                            <ArrowUpRight aria-hidden className="size-3.5" />
                                        </a>
                                    </>
                                )}
                            </p>
                        </div>
                    ) : (
                        <p className="text-muted-foreground">
                            Entfernt alles, was die Installation angelegt hat. Das Protokoll der
                            Installation bleibt erhalten.
                        </p>
                    )}
                </div>
                <div className="sm:max-w-xs sm:shrink-0">
                    <UninstallButton installationId={installation.id} size="md" />
                </div>
            </div>
        </section>
    )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</h3>
            {children}
        </div>
    )
}

/**
 * One link out of the marketplace: what it is, its name, and in which system
 * it opens. Every row names its target, so a click never lands somewhere
 * unexpected.
 */
function OpenRow({
    icon: Icon,
    kind,
    name,
    href,
    target,
    children,
}: {
    icon: LucideIcon
    kind: string
    name: string
    href: string
    target: string
    children?: React.ReactNode
}) {
    return (
        <li>
            <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/60"
            >
                <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 break-words">
                    <span className="text-muted-foreground">{kind}</span>{' '}
                    <span className="font-medium text-foreground">„{name}“</span>
                </span>
                {children}
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                    {target}
                    <ArrowUpRight aria-hidden className="size-3.5" />
                </span>
            </a>
        </li>
    )
}
