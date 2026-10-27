'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useShareView } from '@/components/export/share-listing-provider'
import type { ShareTab, ShareTabs } from '@/lib/export/share-tabs'
import { cn } from '@/lib/utils'

/**
 * The tab bar of "Teilen" (plan of 2026-10-18, section 2 and the decisions):
 * three links, each its own page, always in the same place under the
 * heading. Links, not ARIA tabs: each tab has its own address, and browser
 * back moves between them as between any pages.
 *
 * The active tab has two cues, underline and bold, and `aria-current`. „In
 * Arbeit“ and „Veröffentlicht“ show a count; „Beendet“, a log that only grows,
 * none. Each label reserves the width of its bold form, and each count the
 * width of two digits, so the bar does not move when the page changes or the
 * counts arrive a second or two later. Too wide for a phone, it scrolls
 * sideways inside itself, never the page.
 */

export const SHARE_TAB_LINKS: readonly { tab: ShareTab; label: string; href: string }[] = [
    { tab: 'in-progress', label: 'In Arbeit', href: '/export' },
    { tab: 'published', label: 'Veröffentlicht', href: '/export/shared' },
    { tab: 'ended', label: 'Beendet', href: '/export/ended' },
]

/** The tab a page belongs to; none for the wizard or anything else. */
export function activeShareTab(pathname: string): ShareTab | undefined {
    const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
    return SHARE_TAB_LINKS.find((link) => link.href === path)?.tab
}

/** What the bar counts; a count left out shows as reserved space. */
export interface TabCounts {
    /** Entries in „In Arbeit“, started shares included. */
    inProgress?: number
    published?: number
}

/**
 * The counts, from what is known so far: none while the browser or GitLab is
 * still read, or when GitLab could not be read - a count of only the started
 * shares would then be too low. Without the right to see what was submitted,
 * „In Arbeit“ holds only the started shares, so that is its whole count.
 */
export function tabCounts(view: {
    enabled: boolean
    draftsReady: boolean
    drafts: number
    rows: unknown[] | null
    error?: string
    counts: ShareTabs['counts']
}): TabCounts | undefined {
    if (!view.draftsReady) return undefined
    if (!view.enabled) return { inProgress: view.drafts }
    if (view.rows === null || view.error) return undefined
    return { inProgress: view.counts.inProgress, published: view.counts.published }
}

const entries = (count: number) => `${count} ${count === 1 ? 'Eintrag' : 'Einträge'}`

/** „6“ to see, „6 Einträge“ to hear; the room for two digits kept while it is not known yet. */
function Count({ total }: { total?: number }) {
    return (
        <span className="inline-block min-w-[2ch] text-left text-xs font-normal tabular-nums text-muted-foreground">
            {total !== undefined && (
                <>
                    <span aria-hidden>{total}</span>
                    <span className="sr-only">{`, ${entries(total)}`}</span>
                </>
            )}
        </span>
    )
}

/** The label at its own weight, over an invisible bold copy that holds the width of the active form. */
function Label({ text }: { text: string }) {
    return (
        <span className="inline-grid">
            <span className="col-start-1 row-start-1">{text}</span>
            <span aria-hidden className="invisible col-start-1 row-start-1 font-semibold">
                {text}
            </span>
        </span>
    )
}

/** The bar itself, from the active tab and the counts; server-renderable, for the page and its tests. */
export function ShareTabsNav({ active, counts }: { active?: ShareTab; counts?: TabCounts }) {
    return (
        // `relative`: the links' offsets are measured from the bar, to scroll the active one into it.
        <nav aria-label="Bereiche von Teilen" className="relative overflow-x-auto">
            <ul className="flex min-w-max gap-6 border-b">
                {SHARE_TAB_LINKS.map((link) => {
                    const current = link.tab === active
                    return (
                        <li key={link.tab}>
                            {/* The focus ring drawn inside the link: the bar's scrolling would cut off one drawn around it. */}
                            <Link
                                href={link.href}
                                aria-current={current ? 'page' : undefined}
                                className={cn(
                                    '-mb-px flex items-baseline gap-1.5 whitespace-nowrap border-b-2 py-2 text-sm transition-colors focus-visible:-outline-offset-2',
                                    current
                                        ? 'border-foreground font-semibold text-foreground'
                                        : 'border-transparent text-muted-foreground hover:text-foreground',
                                )}
                            >
                                <Label text={link.label} />
                                {link.tab === 'in-progress' && <Count total={counts?.inProgress} />}
                                {link.tab === 'published' && <Count total={counts?.published} />}
                            </Link>
                        </li>
                    )
                })}
            </ul>
        </nav>
    )
}

/**
 * The bar on the pages, with the active tab from the address and the counts
 * from the listing. `enabled`: this person may see what was submitted.
 */
export function ShareTabsBar({ enabled }: { enabled: boolean }) {
    const pathname = usePathname()
    const view = useShareView(enabled)
    const active = activeShareTab(pathname)
    const frame = useRef<HTMLDivElement>(null)

    // On a narrow screen the active tab may sit past the edge of the bar: brought into it, without moving the page.
    useEffect(() => {
        const link = frame.current?.querySelector<HTMLElement>('[aria-current="page"]')
        const bar = link?.closest('nav')
        if (!link || !bar || bar.scrollWidth <= bar.clientWidth) return
        bar.scrollLeft = Math.max(0, link.offsetLeft - (bar.clientWidth - link.offsetWidth) / 2)
    }, [active])

    const counts = tabCounts({
        enabled,
        draftsReady: view.draftsReady,
        drafts: view.drafts.length,
        rows: view.rows,
        error: view.error,
        counts: view.tabs.counts,
    })
    return (
        <div ref={frame}>
            <ShareTabsNav active={active} counts={counts} />
        </div>
    )
}
