import Link from 'next/link'
import { Archive, ArrowRight, CircleAlert } from 'lucide-react'

import { AddonIcon } from '@/components/catalog/addon-icon'
import { CurationTierBadge } from '@/components/catalog/curation-tier'
import type { ParsedAddon } from '@/lib/addon-catalog'

/**
 * One add-on in the grid, in the prototype's layout: monogram tile left,
 * name and publisher on the first line, no header art (that identity belongs
 * to use cases). An incomplete listing is shown, not hidden — with a marker
 * that it cannot be installed from here.
 */
export function AddonListingCard({ entry }: { entry: ParsedAddon }) {
    const { listing, missingForInstall } = entry
    const installable = missingForInstall.length === 0

    return (
        <Link
            href={`/add-ons/${listing.id}`}
            className="group flex h-full flex-col gap-4 rounded-xl border bg-card p-5 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
            <div className="flex items-start gap-3">
                <AddonIcon name={listing.displayName} />
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                        <h3 className="min-w-0 flex-1 truncate text-base font-semibold leading-tight text-foreground">
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
                    <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                        {listing.summary}
                    </p>
                </div>
            </div>

            <div className="mt-auto flex flex-col gap-3">
                {listing.categories.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
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

                <div className="flex items-center justify-between gap-3 border-t pt-3 text-sm text-muted-foreground">
                    <span className="truncate">{listing.publisher}</span>
                    {listing.compatibleCoreVersions.length > 0 && (
                        <span className="shrink-0 text-xs">
                            Core {listing.compatibleCoreVersions.join(' · ')}
                        </span>
                    )}
                </div>

                <div className="flex items-center justify-between gap-2">
                    {installable ? (
                        <span className="text-xs text-muted-foreground">
                            Version{' '}
                            {listing.install?.source.releaseTag ??
                                listing.install?.source.ref.slice(0, 7)}
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
