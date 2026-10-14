import Link from 'next/link'
import { BookOpen, Check } from 'lucide-react'

import { CatalogIllustration } from '@/components/catalog/catalog-illustration'
import { TierStatus } from '@/components/catalog/curation-tier'
import type { CatalogSummary } from '@/lib/catalog/types'
import { THEME_LABELS } from '@/lib/catalog/vocabulary'

/**
 * One use case in the catalogue grid, the clickdummy's card: the art with the
 * first theme on it, title and two lines of description, and a footer with
 * the seal and who publishes it. The whole card is one link; what an entry
 * offers beyond that (a described entry's source) is on its detail page.
 *
 * Two things the clickdummy has no data for and this catalogue does: whether
 * the use case already runs in this instance, and whether it is only
 * described (no pin, nothing to install). A row without a seal shows no seal,
 * rather than a claim about one.
 */
export function UseCaseCard({ entry, href, installed }: { entry: CatalogSummary; href: string; installed: boolean }) {
    const theme = entry.themes?.[0]

    return (
        <Link
            href={href}
            className="group block rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
            <article className="flex h-full flex-col overflow-hidden rounded-xl border bg-card transition-shadow group-hover:shadow-md">
                <div className="relative">
                    <CatalogIllustration keywords={entry.keywords} themes={entry.themes} className="h-28" />
                    {theme && (
                        <span className="absolute left-3 top-3 inline-flex items-center rounded-md bg-background px-2.5 py-1 text-xs font-medium text-emerald-700 shadow-sm dark:text-emerald-400">
                            {THEME_LABELS[theme]}
                        </span>
                    )}
                    {installed && (
                        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-md bg-background px-2 py-1 text-xs font-medium text-foreground shadow-sm">
                            <Check aria-hidden className="size-3.5 text-emerald-700 dark:text-emerald-400" />
                            Installiert
                        </span>
                    )}
                </div>

                <div className="flex flex-1 flex-col p-5">
                    <h3 className="hyphens-auto break-words text-lg font-semibold leading-tight text-foreground">{entry.displayName}</h3>
                    <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{entry.description}</p>

                    {/* Pins the footer to the card's bottom edge, so a row of cards aligns its footers. */}
                    <div className="min-h-4 flex-1" />
                    <div className="flex items-center justify-between gap-3 border-t pt-4">
                        {entry.curation ? (
                            <TierStatus tier={entry.curation.tier} />
                        ) : !entry.deploymentRef ? (
                            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                                <BookOpen aria-hidden className="size-4 shrink-0" />
                                Praxisbeispiel
                            </span>
                        ) : (
                            <span />
                        )}
                        <span className="truncate text-sm text-muted-foreground">{entry.maintainer}</span>
                    </div>
                </div>
            </article>
        </Link>
    )
}
