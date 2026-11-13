import Link from 'next/link'
import { ArrowLeft, Mail } from 'lucide-react'

import { AddonListingCard } from '@/components/catalog/addon-listing-card'
import { UseCaseCard } from '@/components/catalog/use-case-card'
import { ExternalAnchor } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/layout'
import { monogram, type OrganisationEntries } from '@/lib/catalog/organisations'
import type { CatalogSummary, Organisation } from '@/lib/catalog/types'
import { catalogEntryHref } from '@/lib/use-case-catalog/path'

const GRID = 'grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3'

/** An organisation and what it does in the catalogue; role headings only when it has more than one role. */
export function OrganisationView({
    organisation,
    entries,
    installed,
}: {
    organisation: Organisation
    entries: OrganisationEntries
    installed: ReadonlySet<string>
}) {
    const { name, website, contact } = organisation
    const roles = [
        { title: 'Federführend', rows: entries.led },
        { title: 'Herausgegeben', rows: entries.published },
    ].filter((role) => role.rows.length > 0)
    const cards = (rows: CatalogSummary[]) => (
        <div className={GRID}>
            {rows.map((entry) => (
                <UseCaseCard
                    key={entry.id}
                    entry={entry}
                    href={catalogEntryHref(entry.id)}
                    installed={installed.has(entry.id)}
                    hidePublisher={entry.maintainerOrg === organisation.id}
                />
            ))}
        </div>
    )

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
            <Link href="/use-cases" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                <ArrowLeft className="size-4" />
                Zurück zu den Anwendungsfällen
            </Link>

            <header className="flex items-center gap-4">
                {/* Neutral: colour marks a kind of thing, and an organisation is none of them (design system §4.2). */}
                <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-md bg-muted text-base font-semibold text-muted-foreground">
                    {monogram(name)}
                </span>
                <div className="min-w-0">
                    <h1 className="break-words">{name}</h1>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        {website && <ExternalAnchor href={website}>{new URL(website).host}</ExternalAnchor>}
                        <span className="inline-flex min-w-0 items-center gap-1">
                            <Mail aria-hidden className="size-3.5 shrink-0" />
                            {contact ? (
                                <span className="min-w-0 break-all">
                                    {contact.name && `${contact.name}: `}
                                    <a href={`mailto:${contact.email}`} className="font-medium text-primary underline-offset-2 hover:underline">
                                        {contact.email}
                                    </a>
                                </span>
                            ) : (
                                'Keine zentrale Kontaktstelle hinterlegt'
                            )}
                        </span>
                    </div>
                </div>
            </header>

            {roles.length === 0 && entries.addons.length === 0 && <EmptyState>Noch keine Anwendungsfälle im Katalog.</EmptyState>}

            {roles.map((role) => (
                <section key={role.title} className="flex flex-col gap-4">
                    <h2>
                        {roles.length > 1 ? role.title : 'Anwendungsfälle'} ({role.rows.length})
                    </h2>
                    {cards(role.rows)}
                </section>
            ))}

            {entries.addons.length > 0 && (
                <section className="flex flex-col gap-4">
                    <h2>Add-ons ({entries.addons.length})</h2>
                    <div className={GRID}>
                        {entries.addons.map((addon) => (
                            <AddonListingCard key={addon.listing.id} entry={addon} />
                        ))}
                    </div>
                </section>
            )}
        </div>
    )
}
