import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
    ArrowLeft,
    ArrowUpRight,
    Building2,
    Check,
    ClipboardList,
    ExternalLink,
    Globe,
    Handshake,
} from 'lucide-react'

import { CatalogIllustration } from '@/components/catalog/catalog-illustration'
import { Chips } from '@/components/catalog/chip'
import { Code } from '@/components/catalog/code'
import { CurationTierBadge, curationHint } from '@/components/catalog/curation-tier'
import { InstallDialog } from '@/components/catalog/install-dialog'
import { InstallationSection } from '@/components/catalog/installation-section'
import { SamplePreview } from '@/components/catalog/sample-preview'
import { findUseCaseByPath } from '@/lib/catalog/source'
import { catalogEntryHref, isCanonicalPath } from '@/lib/use-case-catalog/path'
import { FIELD_LABELS } from '@/lib/catalog/vocabulary'
import { fetchCanCreateDatapool, fetchDatapools, type DatapoolListing } from '@/lib/datapools'
import { fetchDatasetOverview, type DatasetOverview } from '@/lib/datapool-of-dataset'
import { fetchInstalledDashboards, type InstalledDashboardLink } from '@/lib/installed-dashboards'
import { fetchActiveInstallation } from '@/lib/installations'
import { getAccessToken, requireSession } from '@/lib/session'
import {
    buildUseCaseListing,
    collaborationInvite,
    logicModelSteps,
    factGroups,
    type Fact,
} from '@/lib/use-case-catalog/listing'
import { isSimulatorConfigured, listSimulations } from '@/lib/simulator/client'
import { streamsOfInstallation, type InstallationStream } from '@/lib/simulator/registration'
import { simulatorUiUrl } from '@/lib/simulator/ui-links'

/**
 * One use case in full, for the person who has to decide whether their
 * municipality should run it.
 *
 * Two kinds of entry share this page. A PACKAGED one can be installed here; a
 * DESCRIBED one documents an implementation running somewhere else and links
 * to it. They are not two templates: the same row shape carries both, and the
 * pin is the only thing that differs, so the page branches on the pin in two
 * places and is otherwise one layout.
 *
 * The hero is for deciding: what this is, and installing it. Once installed,
 * everything about running it (links into portal, Superset and simulator,
 * maintenance, removal) moves into its own section below, so the two concerns
 * never share one row of buttons.
 */
export default async function UseCaseDetailPage({
    params,
}: {
    params: Promise<{ publisher: string; slug: string }>
}) {
    await requireSession()

    const { publisher, slug } = await params
    const summary = await findUseCaseByPath(publisher, slug)
    if (summary && !isCanonicalPath(summary.id, publisher, slug)) {
        redirect(catalogEntryHref(summary.id))
    }
    if (!summary) notFound()

    const listing = buildUseCaseListing(summary)
    const groups = factGroups(summary)
    const logicModel = logicModelSteps(summary)
    const collaboration = collaborationInvite(summary)

    // The reads start at once. Only an entry that can be installed needs the
    // datapools and the right to create one: a described one has no dialog to
    // choose a target in.
    const [installation, datapools, canCreateDatapool] = await Promise.all([
        fetchActiveInstallation(listing.id),
        listing.install ? fetchDatapools() : Promise.resolve<DatapoolListing>({ pools: [] }),
        listing.install ? fetchCanCreateDatapool() : Promise.resolve(false),
    ])
    const installed = installation !== null
    // What depends on the installation waits for it, and the three reads start
    // together. The dataset gives the pool for the link into the portal (read
    // from the dataset, not from the install record: a dataset can be moved to
    // another pool later) and the release status.
    const [dataset, dashboards, streams]: [
        DatasetOverview | null,
        InstalledDashboardLink[],
        InstallationStream[] | null,
    ] = installation
        ? await Promise.all([
              installation.dataSetId
                  ? fetchDatasetOverview(installation.dataSetId, await getAccessToken())
                  : Promise.resolve(null),
              fetchInstalledDashboards(listing.id, installation.id),
              readInstallationStreams(installation.id),
          ])
        : [null, [], null]
    const previewAvailable = isSimulatorConfigured()

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
            <Link
                href="/use-cases"
                className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
                <ArrowLeft className="size-4" />
                Zurück zu den Use Cases
            </Link>

            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="flex min-w-0 flex-col gap-6">
                    <section className="overflow-hidden rounded-xl border border-t-2 border-t-emerald-600 bg-card">
                        <CatalogIllustration
                        keywords={listing.keywords}
                        themes={summary.themes}
                        className="h-24 lg:h-28"
                    />

                        <div className="p-6 lg:p-8">
                            <div className="flex flex-wrap items-center gap-1.5">
                                {listing.themes.map((theme) => (
                                    <span
                                        key={theme}
                                        className="rounded-md bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"
                                    >
                                        {theme}
                                    </span>
                                ))}
                            </div>

                            <div className="mt-3 flex flex-col items-start gap-2">
                                <h1 className="text-3xl font-bold leading-tight text-foreground lg:text-4xl">
                                    {listing.displayName}
                                </h1>
                                <div className="flex flex-wrap items-center gap-2">
                                    {listing.curation && <CurationTierBadge tier={listing.curation.tier} />}
                                    {installed && (
                                        <span className="inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-0.5 text-xs font-medium text-success dark:bg-success/20">
                                            <Check className="size-3.5" />
                                            Bereits installiert
                                        </span>
                                    )}
                                </div>
                            </div>

                            <p className="mt-4 max-w-3xl text-lg leading-relaxed text-muted-foreground">
                                {listing.description}
                            </p>

                            <div className="mt-5 flex items-center gap-2.5">
                                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                                    <Building2 className="size-4" />
                                </span>
                                <span className="flex flex-col leading-tight">
                                    <span className="text-sm font-medium text-foreground">
                                        {listing.publisher}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {listing.publisherRole}
                                    </span>
                                </span>
                            </div>
                            {/* Deciding only. Installed, the dialog renders nothing
                                (until it has an outcome of its own to show) and the
                                sample preview gives way to the live streams below,
                                so the row collapses instead of leaving a gap. */}
                            {listing.install && (
                                <div className="mt-5 flex flex-wrap items-start gap-2 empty:hidden">
                                    <InstallDialog
                                        entryId={listing.id}
                                        displayName={listing.displayName}
                                        version={listing.version}
                                        installed={installed}
                                        demoAvailable={previewAvailable}
                                        datapools={datapools.pools}
                                        datapoolProblem={datapools.problem}
                                        canCreateDatapool={canCreateDatapool}
                                    />
                                    {previewAvailable && !installed && (
                                        <SamplePreview entryId={listing.id} displayName={listing.displayName} />
                                    )}
                                </div>
                            )}

                            {/* An installable entry's reference is its package source,
                                a technical detail; it is listed there. A described
                                entry has nothing else to offer, so it stays here. */}
                            {listing.reference && !listing.install && (
                                <div className="mt-5 flex flex-col items-start gap-1.5">
                                    <a
                                        href={listing.reference.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
                                    >
                                        {listing.reference.source ?? 'Zum Praxisbeispiel'}
                                        <ArrowUpRight className="size-4" />
                                    </a>
                                    {listing.state === 'described' && (
                                        <p className="text-xs text-muted-foreground">
                                            Dieser Eintrag beschreibt eine Umsetzung, die anderswo läuft. Er
                                            lässt sich hier nicht installieren.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </section>

                    {installation && (
                        <InstallationSection
                            installation={installation}
                            dataset={dataset}
                            dashboards={dashboards}
                            streams={streams}
                            simulatorUiBase={simulatorUiUrl()}
                        />
                    )}

                    {logicModel.length > 0 && (
                        <section className="rounded-md border bg-card p-6">
                            <h2 className="text-lg font-semibold text-foreground">
                                Was dieser Anwendungsfall bewirkt
                            </h2>
                            <p className="mt-1.5 text-sm text-muted-foreground">
                                Von dem, was eingesetzt wurde, bis zu dem, was sich dadurch ändert.
                            </p>
                            <ol className="mt-5 flex flex-col gap-5">
                                {logicModel.map((step, position) => (
                                    <li key={step.key} className="flex gap-4">
                                        <span
                                            aria-hidden
                                            className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-500"
                                        >
                                            {String(position + 1).padStart(2, '0')}
                                        </span>
                                        <div className="min-w-0">
                                            <h3 className="text-sm font-semibold text-foreground">
                                                {step.label}
                                                <span className="ml-2 font-normal text-muted-foreground">
                                                    {step.gloss}
                                                </span>
                                            </h3>
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                {step.hint}
                                            </p>
                                            <p className="mt-2 text-sm leading-relaxed text-foreground">
                                                {step.text}
                                            </p>
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        </section>
                    )}

                </div>

                <aside
                    aria-label="Steckbrief"
                    className="min-w-0 overflow-hidden rounded-lg border bg-card lg:sticky lg:top-4"
                >
                    <div className="flex items-center gap-2 border-b px-5 py-3">
                        <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                            <ClipboardList className="size-4" />
                        </span>
                        <h2 className="text-sm font-semibold text-foreground">Auf einen Blick</h2>
                    </div>

                    {(listing.curation || groups.some((group) => group.key === 'classification')) && (
                        <InfoGroup label="Einordnung">
                            {listing.curation && (
                                <div className="py-3">
                                    <CurationTierBadge tier={listing.curation.tier} />
                                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                        {curationHint(listing.curation.tier)}
                                    </p>
                                    {listing.curation.notes && (
                                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                            {listing.curation.notes}
                                        </p>
                                    )}
                                </div>
                            )}
                            <dl>
                                {groups.find((group) => group.key === 'classification')?.facts.map((fact) => (
                                    <FactRow key={fact.label} fact={fact} />
                                ))}
                            </dl>
                        </InfoGroup>
                    )}

                    <InfoGroup label="Wer dahintersteht">
                        <dl>
                            {groups.find((group) => group.key === 'people')?.facts.map((fact) => (
                                <FactRow key={fact.label} fact={fact} />
                            )) ?? (
                                <FactRow
                                    fact={{ label: listing.publisherRole, values: [listing.publisher] }}
                                />
                            )}
                            {listing.contact && (
                                <div className="py-2.5 text-sm">
                                    <dt className="text-xs text-muted-foreground">{FIELD_LABELS.contact}</dt>
                                    <dd className="mt-1 flex flex-col gap-1 break-words">
                                        {listing.contact.name && <span className="font-medium">{listing.contact.name}</span>}
                                        {listing.contact.role && <span className="text-xs text-muted-foreground">{listing.contact.role}</span>}
                                        {listing.contact.email && (
                                            <a href={`mailto:${listing.contact.email}`} className="text-xs text-primary underline-offset-2 hover:underline">
                                                {listing.contact.email}
                                            </a>
                                        )}
                                        {listing.contact.url && (
                                            <a href={listing.contact.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline">
                                                Zur Ansprechstelle
                                                <ExternalLink className="size-3 shrink-0" />
                                            </a>
                                        )}
                                    </dd>
                                </div>
                            )}
                        </dl>
                    </InfoGroup>

                    {groups.filter((group) => group.key === 'costs').map((group) => (
                        <InfoGroup key={group.label} label={group.label}>
                            <dl>
                                {group.facts.map((fact) => <FactRow key={fact.label} fact={fact} />)}
                            </dl>
                        </InfoGroup>
                    ))}

                    {summary.implementation?.collaboration && (
                        <div className="bg-muted/40 px-5 py-3">
                            <p className="flex items-center gap-1.5 text-xs font-semibold">
                                <Handshake aria-hidden className="size-3.5 shrink-0" />
                                {FIELD_LABELS.collaboration}: {collaboration ? 'Ja' : 'Nein'}
                            </p>
                            {collaboration?.seeking && (
                                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{collaboration.seeking}</p>
                            )}
                        </div>
                    )}
                </aside>
            </div>

            <section className="rounded-md border bg-card p-6">
                <h2 className="text-lg font-semibold text-foreground">Technische Details</h2>
                <dl className="mt-3">
                    <Row label="Gelistete Version">
                        <span className="font-mono text-xs">{listing.version}</span>
                    </Row>
                    <Row label="Lizenz">{listing.license}</Row>
                    <Row label="Katalog-ID">
                        <Code>{listing.id}</Code>
                    </Row>
                    {listing.install && (
                        <Row label="Festgelegt auf">
                            <Code>
                                {listing.install.releaseTag ?? listing.install.ref.slice(0, 12)}
                            </Code>
                        </Row>
                    )}
                    {listing.install && listing.reference && (
                        <Row label="Referenz">
                            <a
                                href={listing.reference.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                            >
                                {listing.reference.source ?? 'Quelle'}
                                <ArrowUpRight className="size-4" />
                            </a>
                        </Row>
                    )}
                </dl>

                {listing.stack.length > 0 && (
                    <Block label={FIELD_LABELS.stack}>
                        <Chips items={listing.stack} />
                    </Block>
                )}
                {listing.keywords.length > 0 && (
                    <Block label={FIELD_LABELS.keywords}>
                        <Chips items={listing.keywords} />
                    </Block>
                )}
            </section>

            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Globe className="size-3.5" />
                Eintrag aus dem kuratierten Katalog. Korrekturen laufen über einen Merge Request im
                Katalog-Repository.
            </p>
        </div>
    )
}

/**
 * The installation's demo streams, or null when the simulator is not
 * configured or not reachable. Null and an empty list are different states, as
 * on the installed page: only a REACHABLE simulator without streams is the
 * restart case that the hint to switch them on again exists for.
 */
async function readInstallationStreams(installationId: string): Promise<InstallationStream[] | null> {
    if (!isSimulatorConfigured()) return null
    try {
        return streamsOfInstallation(await listSimulations(), installationId)
    } catch {
        return null
    }
}

function InfoGroup({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <section className="border-b px-5 pb-3 pt-4 last:border-b-0">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</h3>
            {children}
        </section>
    )
}

function FactRow({ fact }: { fact: Fact }) {
    return (
        <div className="flex flex-col gap-0.5 border-b border-border/60 py-2.5 text-sm last:border-b-0">
            <dt className="text-xs text-muted-foreground">{fact.label}</dt>
            <dd className="font-medium text-foreground">
                {fact.badge && (
                    <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {fact.badge}
                    </span>
                )}
                {fact.values.length === 1 ? (
                    fact.values[0]
                ) : (
                    <ul className="flex flex-col gap-0.5">
                        {fact.values.map((value) => (
                            <li key={value}>{value}</li>
                        ))}
                    </ul>
                )}
                {fact.hint && <p className="mt-1 text-xs font-normal leading-relaxed text-muted-foreground">{fact.hint}</p>}
            </dd>
        </div>
    )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2.5 text-sm last:border-b-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium text-foreground">{children}</dd>
        </div>
    )
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="mt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
            </p>
            <div className="mt-2">{children}</div>
        </div>
    )
}
