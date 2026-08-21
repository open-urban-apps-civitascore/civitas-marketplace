import { ExternalLink, Info, Puzzle } from 'lucide-react'

import { CatalogFreshness } from '@/components/catalog/catalog-freshness'
import { getAddons, getCatalogMeta } from '@/lib/catalog/source'
import { requireSession } from '@/lib/session'

/**
 * Infrastructure add-ons (NodeRed, Airflow, …) — a separate top-level
 * catalogue section next to use cases, NOT bundle members. They are listed
 * here for discovery, but deliberately WITHOUT an install button: add-ons are
 * deployed operator-side via GitOps (their deploymentRef points at the addon
 * repo), and the platform offers no API this marketplace could honestly call.
 */
export default async function AddonsPage() {
    await requireSession()
    const addons = await getAddons()
    const meta = await getCatalogMeta()

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1>Add-ons</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Infrastruktur-Bausteine für die Plattform — kuratiert im Katalog, installiert
                    vom Betreiber der Instanz.
                </p>
                <div className="mt-2">
                    <CatalogFreshness meta={meta} />
                </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0" />
                <p>
                    Add-ons werden nicht über den Marketplace installiert, sondern
                    betreiberseitig per GitOps in das Deployment der Instanz aufgenommen. Die
                    Einträge hier verweisen auf das jeweilige Add-on-Repository.
                </p>
            </div>

            {addons.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    {meta.origin === 'mock'
                        ? 'Der lokale Demo-Katalog enthält keine Add-ons — sie kommen aus dem Katalog-Repo (REPO_LIST_URL).'
                        : 'Der Katalog enthält derzeit keine Add-ons.'}
                </p>
            ) : (
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                    {addons.map((addon) => (
                        <article
                            key={addon.id}
                            className="flex h-full flex-col overflow-hidden rounded-xl border bg-card transition-[box-shadow,border-color] hover:border-ring hover:shadow-md"
                        >
                            <div className="relative flex h-24 items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5 dark:from-primary/20 dark:to-primary/10">
                                <Puzzle className="size-9 text-primary/70" />
                                <span className="absolute left-3 top-3 inline-flex items-center rounded-md border bg-card px-2.5 py-1 text-xs font-medium text-primary shadow-sm">
                                    Add-on
                                </span>
                            </div>

                            <div className="flex flex-1 flex-col p-5">
                                <h3 className="text-lg font-semibold leading-tight text-foreground">
                                    {addon.name}
                                </h3>
                                <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                                    {addon.description}
                                </p>

                                {addon.categories.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-1.5">
                                        {addon.categories.map((category) => (
                                            <span
                                                key={category}
                                                className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                                            >
                                                {category}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
                                    <span className="truncate text-sm text-muted-foreground">
                                        {addon.author}
                                        {addon.compatibility.length > 0 &&
                                            ` · CORE ${addon.compatibility
                                                .map((entry) => entry.coreVersion)
                                                .join(', ')}`}
                                    </span>
                                    {addon.licenses?.tool && (
                                        <span
                                            className="max-w-28 shrink-0 truncate text-xs text-muted-foreground"
                                            title={addon.licenses.tool}
                                        >
                                            {addon.licenses.tool}
                                        </span>
                                    )}
                                </div>

                                {addon.repository && (
                                    <div className="mt-4">
                                        <a
                                            href={addon.repository}
                                            target="_blank"
                                            rel="noreferrer noopener"
                                            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
                                        >
                                            <ExternalLink className="size-3.5" />
                                            Add-on-Repository
                                        </a>
                                    </div>
                                )}
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </div>
    )
}
