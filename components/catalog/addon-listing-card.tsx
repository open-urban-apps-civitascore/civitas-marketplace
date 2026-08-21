import Link from 'next/link'
import { Archive, ArrowRight, Blocks, CircleAlert } from 'lucide-react'

import { CurationTierBadge } from '@/components/catalog/curation-tier'
import type { ParsedAddon } from '@/lib/addon-catalog'

/**
 * One add-on in the grid. Says what a card can honestly say: what it is, who
 * vouches for it, which Core versions it supports — and, when the listing is
 * incomplete, that it cannot be installed from here. A catalogue that hides
 * incomplete entries teaches nobody what is missing.
 */
export function AddonListingCard({ entry }: { entry: ParsedAddon }) {
    const { listing, missingForInstall } = entry
    const installable = missingForInstall.length === 0

    return (
        <Link
            href={`/add-ons/${listing.id}`}
            className="group flex h-full flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
            <div className="relative flex h-24 items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
                <Blocks className="size-9 text-primary/70" />
            </div>

            <div className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                    <h3 className="text-lg font-semibold leading-tight text-foreground">
                        {listing.displayName}
                    </h3>
                    {listing.deprecated ? (
                        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            <Archive aria-hidden className="size-3.5" />
                            Veraltet
                        </span>
                    ) : (
                        listing.curation && <CurationTierBadge tier={listing.curation.tier} />
                    )}
                </div>

                <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                    {listing.summary}
                </p>

                {listing.categories.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {listing.categories.slice(0, 4).map((category) => (
                            <span
                                key={category}
                                className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                            >
                                {category}
                            </span>
                        ))}
                    </div>
                )}

                <div className="mt-auto flex items-center justify-between gap-3 border-t pt-4 text-sm text-muted-foreground">
                    <span className="truncate">{listing.publisher}</span>
                    {listing.compatibleCoreVersions.length > 0 && (
                        <span className="shrink-0 text-xs">
                            Core {listing.compatibleCoreVersions.join(' · ')}
                        </span>
                    )}
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                    {installable ? (
                        <span className="text-xs text-muted-foreground">
                            Version{' '}
                            {listing.install?.source.refType === 'tag'
                                ? listing.install.source.ref
                                : listing.install?.source.ref.slice(0, 7)}
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warn">
                            <CircleAlert className="size-3.5" />
                            Angaben unvollständig
                        </span>
                    )}
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
            </div>
        </Link>
    )
}
