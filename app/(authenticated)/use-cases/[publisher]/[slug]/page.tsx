import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, ArrowUpRight, Check, Globe } from 'lucide-react'

import { CatalogIllustration } from '@/components/catalog/catalog-illustration'
import { CurationTierBadge } from '@/components/catalog/curation-tier'
import { DemoDataPanel } from '@/components/catalog/demo-data-panel'
import { InstallDialog } from '@/components/catalog/install-dialog'
import { InstallationSection } from '@/components/catalog/installation-section'
import { LogicModel } from '@/components/catalog/logic-model'
import { PackageInterfaces, PackageParts } from '@/components/catalog/package-parts'
import { SamplePreview } from '@/components/catalog/sample-preview'
import { TechnicalFacts } from '@/components/catalog/technical-facts'
import { UseCaseGallery } from '@/components/catalog/use-case-gallery'
import { UseCaseInfobox } from '@/components/catalog/use-case-infobox'
import { Section } from '@/components/ui/layout'
import { readPackageContents } from '@/lib/catalog/package-contents'
import { findUseCaseByPath } from '@/lib/catalog/source'
import { catalogEntryHref, isCanonicalPath } from '@/lib/use-case-catalog/path'
import { fetchCanCreateDatapool, fetchDatapools, type DatapoolListing } from '@/lib/datapools'
import { fetchDatasetOverview, type DatasetOverview } from '@/lib/datapool-of-dataset'
import { geoportalUrl } from '@/lib/geoportal/files'
import { fetchInstalledDashboards, type InstalledDashboardLink } from '@/lib/installed-dashboards'
import { fetchActiveInstallation } from '@/lib/installations'
import { getAccessToken, requireSession } from '@/lib/session'
import { buildUseCaseListing } from '@/lib/use-case-catalog/listing'
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
 *
 * Laid out as the clickdummy's detail page (redesign 2026-09-22): a reading
 * column with the pitch, the screenshots and the Wirkungslogik beside a sticky
 * Steckbrief, then the technical details full width, in a muted zone that
 * belongs to a different audience.
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

    // The reads start at once. Only an entry that can be installed needs the
    // datapools and the right to create one: a described one has no dialog to
    // choose a target in. What it holds is read from its package, kept per pin,
    // so after the first view of a version it costs nothing.
    const [installation, datapools, canCreateDatapool, contents] = await Promise.all([
        fetchActiveInstallation(listing.id),
        listing.install ? fetchDatapools() : Promise.resolve<DatapoolListing>({ pools: [] }),
        listing.install ? fetchCanCreateDatapool() : Promise.resolve(false),
        readPackageContents(summary),
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
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
            <Link
                href="/use-cases"
                className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
                <ArrowLeft className="size-4" />
                Zurück zu den Anwendungsfällen
            </Link>

            {/* `items-start` is load-bearing: without it the grid stretches the
                Steckbrief to the reading column's height and it no longer sticks. */}
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="flex min-w-0 flex-col gap-6">
                    <section className="overflow-hidden rounded-xl border bg-card">
                        {/* Screenshots live in their own band below; without any, a slim
                            illustration (clearly art, not a fake screenshot) gives the page its face. */}
                        {listing.media.length === 0 && (
                            <CatalogIllustration keywords={listing.keywords} themes={summary.themes} className="h-24 border-b lg:h-28" />
                        )}

                        <div className="flex flex-col gap-4 p-6 lg:p-8">
                            {listing.themes.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {listing.themes.map((theme) => (
                                        <span
                                            key={theme}
                                            className="inline-flex items-center rounded-md bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"
                                        >
                                            {theme}
                                        </span>
                                    ))}
                                </div>
                            )}

                            {/* The badge always directly below the title: inline, its place
                                would depend on whether the title wraps. */}
                            <div className="flex flex-col items-start gap-2">
                                <h1 className="hyphens-auto break-words text-3xl font-bold leading-tight text-foreground lg:text-4xl">
                                    {listing.displayName}
                                </h1>
                                {(listing.curation || installed) && (
                                    <div className="flex flex-wrap items-center gap-2">
                                        {listing.curation && <CurationTierBadge tier={listing.curation.tier} />}
                                        {installed && (
                                            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                                                <Check aria-hidden className="size-3.5 text-emerald-700 dark:text-emerald-400" />
                                                Bereits installiert
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            <p className="max-w-3xl text-lg leading-relaxed text-muted-foreground">{listing.description}</p>

                            {/* Deciding only. Installed, the dialog renders nothing (until it
                                has an outcome of its own to show) and the sample preview gives
                                way to the live streams below, so the row collapses instead of
                                leaving a gap. The install stays in the hero, not in the rail:
                                the rail drops below the text on a phone. */}
                            {listing.install && (
                                <div className="mt-1 flex flex-wrap items-start gap-2 empty:hidden">
                                    <InstallDialog
                                        entryId={listing.id}
                                        displayName={listing.displayName}
                                        version={listing.version}
                                        installed={installed}
                                        demoAvailable={previewAvailable}
                                        datapools={datapools.pools}
                                        datapoolProblem={datapools.problem}
                                        canCreateDatapool={canCreateDatapool}
                                        acknowledge={listing.curation ? (listing.curation.tier === 'experimental' ? 'experimental' : undefined) : 'unreviewed'}
                                        contents={contents}
                                    />
                                    {previewAvailable && !installed && (
                                        <SamplePreview entryId={listing.id} displayName={listing.displayName} />
                                    )}
                                </div>
                            )}

                            {/* An installable entry's reference is its package source, a
                                technical detail listed below. A described entry has nothing
                                else to offer, so it stays here. */}
                            {listing.reference && !listing.install && (
                                <div className="mt-1 flex flex-col items-start gap-1.5">
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

                    <UseCaseGallery
                        media={listing.media}
                        fallback={
                            <CatalogIllustration keywords={listing.keywords} themes={summary.themes} className="h-24 rounded-xl border lg:h-28" />
                        }
                    />

                    {installation && (
                        <InstallationSection
                            installation={installation}
                            dataset={dataset}
                            dashboards={dashboards}
                            streams={streams}
                            simulatorUiBase={simulatorUiUrl()}
                            geoportal={contents?.masterportal ? { ...contents.masterportal, href: geoportalUrl() } : null}
                        />
                    )}

                    {/* Not once installed: the installation section shows the streams themselves. */}
                    {!installed && contents && contents.demoStreams.length > 0 && (
                        <DemoDataPanel streams={contents.demoStreams} simulatorAvailable={previewAvailable} />
                    )}

                    {/* What it is good for, before what you operate it through (Ewa, 2026-09-23). */}
                    <LogicModel entry={summary} />
                </div>

                {/* Sticky and uncapped: when it is taller than the window, the end of the
                    grid pushes it up and its lower part comes into view. */}
                <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-2">
                    <UseCaseInfobox entry={summary} demoData={contents ? contents.demoStreams.length > 0 : undefined} />
                </div>
            </div>

            {/* The technical zone, for IT and data roles: muted, because it belongs to another audience. */}
            <Section title="Technische Details" tone="muted">
                <PackageInterfaces apis={contents?.apis ?? []} />
                <PackageParts parts={contents?.parts ?? []} />
                <TechnicalFacts entry={summary} />
            </Section>

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
