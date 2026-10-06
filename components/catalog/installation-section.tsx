import { Fragment } from 'react'
import Link from 'next/link'
import {
    ArrowDown,
    ArrowUpRight,
    Database,
    FlaskConical,
    FolderOpen,
    Layers,
    LayoutDashboard,
    Radio,
    TriangleAlert,
    type LucideIcon,
} from 'lucide-react'

import { RefreshWhilePending } from '@/components/catalog/refresh-while-pending'
import { ReimportDashboardsButton } from '@/components/catalog/reimport-dashboards-button'
import { SupersetMark } from '@/components/icons/superset-mark'
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

/** While an operation runs, it says more than the status it will end in. */
const PENDING_OPERATION_LABELS: Record<string, string> = {
    CREATE: 'Wird freigegeben …',
    UPDATE: 'Wird aktualisiert …',
    UNRELEASE: 'Freigabe wird zurückgenommen …',
    DELETE: 'Wird gelöscht …',
}

/** Icon tile colours, one per system. */
const TONES = {
    simulator: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    platform: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    dashboards: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
} as const

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
}: {
    installation: ActiveInstallation
    dataset: DatasetOverview | null
    dashboards: InstalledDashboardLink[]
    streams: InstallationStream[] | null
    simulatorUiBase?: string
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

    const groups: { key: string; node: React.ReactNode }[] = []

    if (streams !== null && (streams.length > 0 || demoMissing)) {
        const active = streams.filter(({ status }) => status.enabled).length
        groups.push({
            key: 'simulator',
            node: (
                <SystemGroup
                    icon={FlaskConical}
                    tone="simulator"
                    title="Simulator"
                    subtitle="Demo-Daten, eigenständiges Add-on"
                    meta={streams.length > 0 ? `${active} von ${streams.length} aktiv` : undefined}
                >
                    {streams.map(({ streamName, status }) => (
                        <Item
                            key={status.id}
                            icon={<Radio className="size-4" />}
                            name={streamName}
                            href={simulatorUiBase ? simulationUiHref(simulatorUiBase, status.id) : undefined}
                            target="Simulator"
                            badge={
                                <Chip tone={status.enabled ? 'success' : 'muted'}>
                                    {status.enabled ? 'Aktiv' : 'Pausiert'}
                                </Chip>
                            }
                        />
                    ))}
                    {demoMissing && (
                        <Note>
                            Für diese Installation laufen keine Demo-Daten, zum Beispiel nach einem
                            Neustart des Simulators.{' '}
                            <Link
                                href="/installed"
                                className="font-medium text-primary underline-offset-2 hover:underline"
                            >
                                Unter „Installiert“ einschalten
                            </Link>
                        </Note>
                    )}
                </SystemGroup>
            ),
        })
    }

    if (installation.dataSetId || dataset?.datapool) {
        groups.push({
            key: 'platform',
            node: (
                <SystemGroup icon={Layers} tone="platform" title="Plattform" subtitle="CIVITAS/CORE">
                    {/* Container first, then what it contains. */}
                    {dataset?.datapool && (
                        <Item
                            icon={<FolderOpen className="size-4" />}
                            kind="Datenpool"
                            name={dataset.datapool.name}
                            href={datapoolHref(dataset.datapool.id)}
                            target="Portal"
                        />
                    )}
                    {installation.dataSetId && (
                        <Item
                            icon={<Database className="size-4" />}
                            kind="Datensatz"
                            name={installation.dataSetName ?? 'Datensatz'}
                            href={datasetHref(installation.dataSetId)}
                            target="Portal"
                            badge={
                                dataset?.status ? (
                                    <Chip tone={released ? 'success' : 'muted'}>
                                        {(dataset.pendingOperation
                                            ? PENDING_OPERATION_LABELS[dataset.pendingOperation]
                                            : undefined) ??
                                            DATASET_STATUS_LABELS[dataset.status] ??
                                            dataset.status}
                                    </Chip>
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
                </SystemGroup>
            ),
        })
    }

    if (dashboards.length > 0) {
        groups.push({
            key: 'dashboards',
            node: (
                <SystemGroup
                    icon={LayoutDashboard}
                    tone="dashboards"
                    title="Dashboards"
                    subtitle="Auswertung"
                    footer={<ReimportDashboardsButton installationId={installation.id} />}
                >
                    {dashboards.map((dashboard) => (
                        <Item
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
                </SystemGroup>
            ),
        })
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

            {groups.length > 0 && (
                <div className="flex flex-col px-6 py-5">
                    {groups.map(({ key, node }, index) => (
                        <Fragment key={key}>
                            {index > 0 && <FlowArrow />}
                            {node}
                        </Fragment>
                    ))}
                </div>
            )}

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

/**
 * One system the installation lives in. Its things hang off the icon tile on a
 * guide line: `ml-[1.875rem]` is the tile's centre (`px-4` plus half of
 * `size-7`), so the line starts right below it.
 */
function SystemGroup({
    icon: Icon,
    tone,
    title,
    subtitle,
    meta,
    footer,
    children,
}: {
    icon: LucideIcon
    tone: keyof typeof TONES
    title: string
    subtitle?: string
    meta?: string
    footer?: React.ReactNode
    children: React.ReactNode
}) {
    return (
        <div className="rounded-lg border bg-card">
            <div className="flex items-center gap-3 px-4 pb-2 pt-3">
                <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-md ${TONES[tone]}`}>
                    <Icon className="size-4" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col leading-tight">
                    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                    {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
                </div>
                {meta && <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>}
            </div>
            <div className="mb-3 ml-[1.875rem] mr-3 border-l border-border">
                <ul>{children}</ul>
                {footer && <div className="pl-4 pt-2">{footer}</div>}
            </div>
        </div>
    )
}

/**
 * One thing in a system: what it is, its name, and where a click opens it.
 * Without `href` the row only reports, for a system the page cannot link into.
 */
function Item({
    icon,
    kind,
    name,
    href,
    target,
    badge,
    note,
}: {
    icon: React.ReactNode
    kind?: string
    name: string
    href?: string
    target?: string
    badge?: React.ReactNode
    note?: string
}) {
    const body = (
        <>
            <span className="flex items-center gap-3">
                <span aria-hidden className="flex w-5 shrink-0 justify-center text-muted-foreground">
                    {icon}
                </span>
                <span className="min-w-0 flex-1 break-words">
                    {kind ? (
                        <>
                            <span className="text-muted-foreground">{kind}</span>{' '}
                            <span className="font-medium text-foreground">„{name}“</span>
                        </>
                    ) : (
                        <span className="font-medium text-foreground">{name}</span>
                    )}
                </span>
                {badge}
                {href && target && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                        {target}
                        <ArrowUpRight aria-hidden className="size-3.5" />
                    </span>
                )}
            </span>
            {/* Indented by the icon column, so it reads as part of the name. */}
            {note && <span className="mt-0.5 block pl-8 text-xs leading-relaxed text-muted-foreground">{note}</span>}
        </>
    )
    const row = 'block rounded-r-md py-2 pl-4 pr-3 text-sm'

    return (
        <li className="relative before:absolute before:left-0 before:top-[1.125rem] before:h-px before:w-2.5 before:bg-border">
            {href ? (
                <a href={href} target="_blank" rel="noreferrer" className={`group ${row} transition-colors hover:bg-muted/60`}>
                    {body}
                </a>
            ) : (
                <div className={row}>{body}</div>
            )}
        </li>
    )
}

function Note({ children }: { children: React.ReactNode }) {
    return <li className="py-2 pl-4 pr-3 text-xs leading-relaxed text-muted-foreground">{children}</li>
}

function Chip({ tone, children }: { tone: 'success' | 'muted'; children: React.ReactNode }) {
    return (
        <span
            className={
                tone === 'success'
                    ? 'shrink-0 rounded bg-success/10 px-1.5 py-0.5 text-xs text-success dark:bg-success/20'
                    : 'shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'
            }
        >
            {children}
        </span>
    )
}

/** The data moves on to the next system. Centred under the icon tiles. */
function FlowArrow() {
    return (
        <div aria-hidden className="flex h-7 items-center pl-[23px] text-muted-foreground/60">
            <ArrowDown className="size-4" />
        </div>
    )
}
