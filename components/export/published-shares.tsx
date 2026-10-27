'use client'

import Link from 'next/link'
import { PackagePlus } from 'lucide-react'

import { useShareView } from '@/components/export/share-listing-provider'
import { ShareRow } from '@/components/export/share-row'
import { elsewhereLine, EmptyTab } from '@/components/export/share-tab-states'
import { buttonClass, ExternalAnchor } from '@/components/ui/button'
import { Notice, Pending } from '@/components/ui/notice'
import { inProgressLinkText } from '@/lib/export/in-progress-items'
import { publishedLine, type PublishedLine } from '@/lib/export/published-lines'
import type { TabRow } from '@/lib/export/share-tabs'

/** A link inside the marketplace, in the look of `ExternalAnchor` without its ↗. */
const PAGE_LINK = 'font-medium text-primary underline-offset-2 hover:underline'

/** „Veröffentlicht“ from the share pages' one listing (`useShareView`), so coming from another tab does not ask GitLab again. */
export function PublishedShares() {
    const view = useShareView(true)
    if (view.rows === null) return <Pending>Stand bei GitLab wird abgefragt …</Pending>
    // The dates are told against the reading, so they do not change between two renders.
    const now = view.readAt ? Date.parse(view.readAt) : undefined
    return <Published rows={view.tabs.published} elsewhere={view.tabs.elsewhere.published} error={view.error} now={now} instance={view.instance} />
}

/**
 * „Veröffentlicht“: what this instance put into the catalogue through this
 * marketplace, one card per entry at its listed version. „Neue Version teilen“
 * is secondary, as the page's one primary is „Neues Paket teilen“.
 */
export function Published({
    rows,
    elsewhere = 0,
    error,
    now,
    instance,
}: {
    rows: TabRow[]
    elsewhere?: number
    error?: string
    now?: number
    /** This instance as the listing names it, for `ofUnknownInstance`. */
    instance?: string
}) {
    return (
        <div className="flex flex-col gap-4">
            {/* In the words the other two tabs use; „Aktualisieren“ above asks again. */}
            {error && (
                <Notice tone="error" live>
                    Was im Katalog steht, ließ sich gerade nicht abfragen ({error}).
                </Notice>
            )}
            {rows.length === 0 ? (
                !error && <EmptyTab tab="published" />
            ) : (
                <ul className="flex flex-col gap-4">
                    {rows.map((tabbed) => (
                        <PublishedRow key={tabbed.row.key} line={publishedLine(tabbed, { now, instance })} />
                    ))}
                </ul>
            )}
            {elsewhere > 0 && <p className="text-sm text-muted-foreground">{elsewhereLine(elsewhere)}</p>}
        </div>
    )
}

export function PublishedRow({ line }: { line: PublishedLine }) {
    const next = line.next
    return (
        <ShareRow
            title={line.title}
            version={line.version}
            origin={line.facts}
            reasons={line.reasons}
            earlier={line.earlier}
            actions={
                <>
                    <Link href={line.catalogHref} className={`${PAGE_LINK} text-sm`}>
                        Im Katalog ansehen
                    </Link>
                    {line.gitlabHref && (
                        <ExternalAnchor href={line.gitlabHref} className="text-sm">
                            In GitLab ansehen
                        </ExternalAnchor>
                    )}
                    {next?.kind === 'new-version' && (
                        <Link href={next.href} className={buttonClass('secondary')}>
                            <PackagePlus aria-hidden className="size-4" />
                            Neue Version teilen
                        </Link>
                    )}
                    {/* In the button's place while a newer version is under way. */}
                    {next?.kind === 'newer' && (
                        <Link href={next.href} className={`${PAGE_LINK} text-sm`}>
                            {inProgressLinkText(next.version, next.declined)}
                        </Link>
                    )}
                </>
            }
        />
    )
}
