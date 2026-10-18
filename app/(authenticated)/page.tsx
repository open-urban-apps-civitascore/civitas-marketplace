import Link from 'next/link'
import { Share2 } from 'lucide-react'

import { CatalogFreshness } from '@/components/catalog/catalog-freshness'
import { CatalogHighlights } from '@/components/catalog/catalog-highlights'
import { buttonClass } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/layout'
import { listAddons } from '@/lib/addon-catalog'
import { catalogPreview } from '@/lib/catalog/highlights'
import { getCatalogMeta, getCatalogSummaries } from '@/lib/catalog/source'
import { requireSession } from '@/lib/session'
import { catalogEntryHref } from '@/lib/use-case-catalog/path'

/**
 * The marketplace's front page, the clickdummy's (app/marketplace/page.tsx,
 * rewritten after the feedback of 2026-10-03, "zu viel Textwand"). It answers
 * four things, in this order: what you can do here (title), why (one
 * sentence), how it works (three steps), and what is in the catalogue.
 *
 * The steps are editorial type, not boxes: boxes forced equal heights onto
 * unequal text and left tiles half empty. A numbered sequence with a rule per
 * column cannot look half empty, because nothing in it is a container.
 *
 * The steps name what a reader meets later: the "Nachnutzen" button, the
 * demo-data choice in its dialog, the switch to their own data.
 */
const STEPS = [
    {
        title: 'Finden',
        body: 'Jeder Eintrag zeigt, wer ihn betreibt, was er kostet und wie weit die Umsetzung ist.',
    },
    {
        title: 'Nachnutzen',
        body: 'Die Lösung wird in Ihrer eigenen Instanz eingerichtet. Bringt sie Demo-Daten mit, läuft sie sofort, noch ohne eigene Daten.',
    },
    {
        title: 'Eigene Daten anschließen',
        body: 'Passt die Lösung, stellen Sie im Portal auf Ihre eigenen Daten um. Wenn nicht, entfernen Sie sie wieder.',
    },
]

export default async function MarketplacePage() {
    await requireSession()
    const [useCases, { addons }, dataStructures, meta] = await Promise.all([
        getCatalogSummaries('usecase'),
        listAddons(),
        getCatalogSummaries('datastructure'),
        getCatalogMeta(),
    ])

    // One line per section on what it is and how it relates to the use cases:
    // the three sections are one system.
    const sections = [
        {
            ...catalogPreview(
                'use-case',
                'Anwendungsfälle',
                '/use-cases',
                useCases.map((entry) => ({ id: entry.id, title: entry.displayName, summary: entry.description, meta: entry.maintainer, href: catalogEntryHref(entry.id) })),
            ),
            hint: 'Fertige Lösungen für eine Aufgabe - samt der nötigen Datenstrukturen.',
        },
        {
            ...catalogPreview(
                'addon',
                'Add-ons',
                '/add-ons',
                addons.map(({ listing }) => ({ id: listing.id, title: listing.displayName, summary: listing.summary, meta: listing.publisher, href: `/add-ons/${listing.id}` })),
            ),
            hint: 'Zusätzliche Werkzeuge für Ihre Instanz - die Einrichtung übernimmt Ihr Betrieb.',
        },
        {
            // Data structures have no page of their own yet, so their rows lead to the list.
            ...catalogPreview(
                'data-structure',
                'Datenstrukturen',
                '/datastructures',
                dataStructures.map((entry) => ({ id: entry.id, title: entry.displayName, summary: entry.description, meta: entry.maintainer, href: '/datastructures' })),
            ),
            hint: 'Gemeinsame Datenformate - damit Lösungen zu Ihren Daten passen.',
        },
    ]

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
            <PageHeader
                title="Lösungen anderer Kommunen nachnutzen"
                lead="Sie wollen in Ihrer Kommune ein Problem lösen oder eine Idee umsetzen? Gut möglich, dass eine andere Kommune dafür schon eine Lösung auf CIVITAS/CORE gebaut hat. Die übernehmen Sie hier, statt neu zu bauen."
            />

            <section aria-labelledby="ablauf-heading">
                <h2 id="ablauf-heading" className="text-xl font-semibold text-foreground">
                    So funktioniert’s
                </h2>
                <ol className="mt-8 grid grid-cols-1 gap-x-10 gap-y-10 sm:grid-cols-3">
                    {STEPS.map((step, position) => (
                        <li key={step.title} className="border-t-2 border-primary/70 pt-5">
                            <p aria-hidden className="text-sm font-semibold tabular-nums text-primary">
                                {String(position + 1).padStart(2, '0')}
                            </p>
                            <h3 className="mt-3 text-lg font-semibold leading-snug text-foreground">{step.title}</h3>
                            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                        </li>
                    ))}
                </ol>
            </section>

            <CatalogHighlights sections={sections} heading="Im Katalog" />

            {/* Answers what a provider worries about (secrets, local settings), not the packaging work. */}
            <section className="flex flex-col items-start gap-4 rounded-xl border bg-muted/30 p-6 sm:flex-row sm:items-center sm:justify-between lg:p-8">
                <div className="max-w-2xl">
                    <p className="text-base font-semibold text-foreground">Eigene Lösung teilen</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Läuft bei Ihnen ein Anwendungsfall, der anderen Kommunen helfen würde? Geteilt wird der Aufbau -
                        Zugangsdaten und gespeicherte Daten bleiben bei Ihnen.
                    </p>
                </div>
                <Link href="/export" className={`${buttonClass('primary')} h-10 shrink-0 px-4`}>
                    <Share2 aria-hidden className="size-4" />
                    Neu teilen
                </Link>
            </section>

            <CatalogFreshness meta={meta} />
        </div>
    )
}
