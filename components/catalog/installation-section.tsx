import Link from 'next/link'
import {
    ArrowUpRight,
    Database,
    FlaskConical,
    FolderOpen,
    Layers,
    LayoutDashboard,
    MapIcon,
    MapPin,
    Radio,
    TriangleAlert,
} from 'lucide-react'

import { ApplyGeoportalButton } from '@/components/catalog/apply-geoportal-button'
import { RefreshWhilePending } from '@/components/catalog/refresh-while-pending'
import { ReimportDashboardsButton } from '@/components/catalog/reimport-dashboards-button'
import { SupersetMark } from '@/components/icons/superset-mark'
import { UninstallButton } from '@/components/installed/uninstall-button'
import { Flow, FlowGroup, FlowItem, FlowNote } from '@/components/ui/flow'
import { StatusPill } from '@/components/ui/status-pill'
import type { DatasetOverview } from '@/lib/datapool-of-dataset'
import type { InstalledDashboardLink } from '@/lib/installed-dashboards'
import type { ActiveInstallation } from '@/lib/installations'
import { datapoolHref, datasetHref } from '@/lib/portal-links'
import type { InstallationStream } from '@/lib/simulator/registration'
import { simulationUiHref } from '@/lib/simulator/ui-links'
import { datasetStatusLabel } from '@/lib/ui/dataset-status'
import { uninstallBlocker } from '@/lib/uninstall-blocker'

/**
 * What an installed use case is in THIS instance, below the catalogue's
 * description of it. The hero above answers "should we install this?"; this
 * card answers "what runs now, and how do I reach, maintain or remove it?",
 * so it only exists for an installed entry.
 *
 * Grouped by the system each thing lives in, because each has its own owner
 * and lifetime: the simulator is an add-on whose streams are gone after a
 * restart, the platform holds the data, Superset shows it. The groups follow
 * the data (generated, processed, shown), and an action sits with the thing it
 * acts on. The removal is set apart at the bottom.
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
    map,
    geoportal,
}: {
    installation: ActiveInstallation
    dataset: DatasetOverview | null
    dashboards: InstalledDashboardLink[]
    streams: InstallationStream[] | null
    simulatorUiBase?: string
    /** The map page, when the package publishes a layer. */
    map?: { href: string; title: string } | null
    /** The package's Masterportal entries, and where the geoportal opens when that is configured. */
    geoportal?: { folder: string; layers: string[]; href?: string } | null
}) {
    const blocker = uninstallBlocker(dataset)
    // A release sets AVAILABLE at once; its pipeline runs only once the
    // platform has provisioned it (the pending CREATE).
    const releasing = dataset?.pendingOperation === 'CREATE'
    const released = dataset?.status === 'AVAILABLE' && !releasing
    // Before that the sinks do not exist yet; an unknown status says nothing.
    const awaitingRelease = dataset?.status !== undefined && !released
    // The restart case of the installed page: a reachable simulator without
    // streams for an installation that could have them.
    const demoMissing = streams !== null && streams.length === 0 && installation.hasDataSource

    // Keyed elements: `Flow` puts the arrows between them.
    const groups: React.ReactNode[] = []

    if (streams !== null && (streams.length > 0 || demoMissing)) {
        const active = streams.filter(({ status }) => status.enabled).length
        groups.push(
            <FlowGroup
                key="simulator"
                icon={FlaskConical}
                tone="simulator"
                title="Simulator"
                subtitle="Demo-Daten, eigenständiges Add-on"
                meta={streams.length > 0 ? `${active} von ${streams.length} aktiv` : undefined}
            >
                {streams.map(({ streamName, status }) => (
                    <FlowItem
                        key={status.id}
                        icon={<Radio className="size-4" />}
                        name={streamName}
                        href={simulatorUiBase ? simulationUiHref(simulatorUiBase, status.id) : undefined}
                        target="Simulator"
                        badge={
                            <StatusPill tone={status.enabled ? 'success' : 'muted'}>
                                {status.enabled ? 'Aktiv' : 'Pausiert'}
                            </StatusPill>
                        }
                    />
                ))}
                {demoMissing && (
                    <FlowNote>
                        Für diese Installation laufen keine Demo-Daten, zum Beispiel nach einem
                        Neustart des Simulators.{' '}
                        <Link
                            href="/installed"
                            className="font-medium text-primary underline-offset-2 hover:underline"
                        >
                            Unter „Installiert“ einschalten
                        </Link>
                    </FlowNote>
                )}
            </FlowGroup>
        )
    }

    if (installation.dataSetId || dataset?.datapool) {
        groups.push(
            <FlowGroup key="platform" icon={Layers} tone="platform" title="Plattform" subtitle="CIVITAS/CORE">
                {/* Container first, then what it contains. */}
                {dataset?.datapool && (
                    <FlowItem
                        icon={<FolderOpen className="size-4" />}
                        kind="Datenpool"
                        name={dataset.datapool.name}
                        href={datapoolHref(dataset.datapool.id)}
                        target="Portal"
                    />
                )}
                {installation.dataSetId && (
                    <FlowItem
                        icon={<Database className="size-4" />}
                        kind="Datensatz"
                        name={installation.dataSetName ?? 'Datensatz'}
                        href={datasetHref(installation.dataSetId)}
                        target="Portal"
                        badge={
                            dataset?.status ? (
                                <StatusPill tone={released ? 'success' : 'muted'}>
                                    {datasetStatusLabel(dataset.status, dataset.pendingOperation)}
                                </StatusPill>
                            ) : undefined
                        }
                        note={
                            releasing
                                ? 'Die Plattform richtet Speicher und Pipeline ein, danach fließen die Daten.'
                                : awaitingRelease
                                  ? 'Daten fließen erst nach der Freigabe im Portal.'
                                  : undefined
                        }
                    />
                )}
            </FlowGroup>
        )
    }

    if (map) {
        groups.push(
            <FlowGroup key="map" icon={MapIcon} tone="map" title="Karte" subtitle="OWS-API (WMS und WFS)">
                <FlowItem
                    icon={<MapPin className="size-4" />}
                    kind="Ebene"
                    name={map.title}
                    href={map.href}
                    target="Karte"
                    note={
                        releasing
                            ? 'Zeigt Punkte, sobald die Freigabe abgeschlossen ist.'
                            : awaitingRelease
                              ? 'Zeigt Punkte erst nach der Freigabe des Datensatzes.'
                              : undefined
                    }
                />
            </FlowGroup>
        )
    }

    if (geoportal) {
        groups.push(
            <FlowGroup
                key="geoportal"
                icon={MapIcon}
                tone="map"
                title="Geoportal"
                subtitle={`Masterportal, Ordner „${geoportal.folder}“`}
                footer={<ApplyGeoportalButton installationId={installation.id} />}
            >
                {geoportal.layers.map((layer) => (
                    <FlowItem
                        key={layer}
                        icon={<MapPin className="size-4" />}
                        kind="Ebene"
                        name={layer}
                        href={geoportal.href}
                        target="Geoportal"
                        note={
                            releasing
                                ? 'Zeigt Daten, sobald die Freigabe abgeschlossen ist.'
                                : awaitingRelease
                                  ? 'Zeigt Daten erst nach der Freigabe des Datensatzes.'
                                  : undefined
                        }
                    />
                ))}
            </FlowGroup>
        )
    }

    if (dashboards.length > 0) {
        groups.push(
            <FlowGroup
                key="dashboards"
                icon={LayoutDashboard}
                tone="dashboards"
                title="Dashboards"
                subtitle="Auswertung"
                footer={<ReimportDashboardsButton installationId={installation.id} />}
            >
                {dashboards.map((dashboard) => (
                    <FlowItem
                        key={dashboard.url}
                        icon={<SupersetMark className="w-5" />}
                        kind="Dashboard"
                        name={dashboard.title}
                        href={dashboard.url}
                        target="Superset"
                        note={
                            releasing
                                ? 'Zeigt Daten, sobald die Freigabe abgeschlossen ist.'
                                : awaitingRelease
                                  ? 'Meldet bis zur Freigabe des Datensatzes eine fehlende Tabelle.'
                                  : undefined
                        }
                    />
                ))}
            </FlowGroup>
        )
    }

    return (
        <section aria-labelledby="installation-heading" className="overflow-hidden rounded-md border bg-card">
            <RefreshWhilePending pending={Boolean(dataset?.pendingOperation)} />
            <div className="border-b px-6 py-4">
                <h2 id="installation-heading" className="text-lg font-semibold text-foreground">
                    In dieser Instanz
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                    Was die Installation angelegt hat, in der Reihenfolge, in der die Daten fließen.
                </p>
            </div>

            {groups.length > 0 && <Flow className="px-6 py-5">{groups}</Flow>}

            <div className="flex flex-col gap-3 border-t bg-muted/20 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1 text-xs leading-relaxed">
                    {blocker ? (
                        <div id="uninstall-blocker" role="note" className="flex gap-2 text-warn">
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
                    <UninstallButton
                        installationId={installation.id}
                        size="md"
                        disabled={blocker !== null}
                        describedBy={blocker ? 'uninstall-blocker' : undefined}
                    />
                </div>
            </div>
        </section>
    )
}
