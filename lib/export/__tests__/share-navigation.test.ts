import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Plain links and a settable address: no app router runs in a static render.
const location = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => location.pathname }))
vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}))

import { AppSidebar, isNavItemActive } from '@/components/layout/app-sidebar'
import { activeShareTab, ShareTabsNav, tabCounts, type TabCounts } from '@/components/export/share-tabs-nav'
import type { ShareTab } from '@/lib/export/share-tabs'

/** What a reader meets: the text, without markup. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

/** The `<a …>` element whose text starts with `label`. */
function link(html: string, label: string): string {
    const found = [...html.matchAll(/<a\b[^>]*>(.*?)<\/a>/g)].find((match) => text(match[1]).startsWith(label))
    if (!found) throw new Error(`no link "${label}" in ${html}`)
    return found[0]
}

const bar = (active?: ShareTab, counts?: TabCounts) => renderToStaticMarkup(createElement(ShareTabsNav, { active, counts }))

describe('the tab bar of „Teilen“', () => {
    it('is a navigation of three links, each its own page', () => {
        const html = bar('in-progress')
        expect(html).toContain('<nav aria-label="Bereiche von Teilen"')
        expect(html).not.toContain('role="tab')
        expect(link(html, 'In Arbeit')).toContain('href="/export"')
        expect(link(html, 'Veröffentlicht')).toContain('href="/export/shared"')
        expect(link(html, 'Beendet')).toContain('href="/export/ended"')
    })

    it('marks the active tab with aria-current, underline and bold, and only it', () => {
        const html = bar('published')
        expect(html.match(/aria-current="page"/g)).toHaveLength(1)
        const active = link(html, 'Veröffentlicht')
        expect(active).toContain('aria-current="page"')
        expect(active).toMatch(/border-foreground/)
        expect(active).toMatch(/font-semibold/)
        expect(link(html, 'In Arbeit')).not.toContain('aria-current')
        expect(link(html, 'In Arbeit')).toContain('border-transparent')
    })

    it('counts what is in progress, with what waits for the person, and says it in words', () => {
        const html = bar('in-progress', { inProgress: 3, mine: 1, published: 2 })
        expect(text(link(html, 'In Arbeit'))).toBe('In Arbeit In Arbeit 3 · 1 bei dir , 3 Einträge, bei 1 bist du dran')
        // The visible count is not read out twice: screen readers hear the sentence.
        expect(link(html, 'In Arbeit')).toContain('<span aria-hidden="true">3 · 1 bei dir</span>')
        expect(text(link(html, 'Veröffentlicht'))).toContain('2 , 2 Einträge')
        expect(text(link(html, 'Beendet'))).toBe('Beendet Beendet')
    })

    it('says nothing about the person’s turn when nothing waits for them', () => {
        const html = bar('in-progress', { inProgress: 1, mine: 0, published: 0 })
        expect(text(link(html, 'In Arbeit'))).toContain('1 , 1 Eintrag')
        expect(html).not.toContain('bei dir')
        expect(text(link(html, 'Veröffentlicht'))).toContain('0 , 0 Einträge')
    })

    it('keeps room for the counts before they arrive, so the bar does not move', () => {
        const html = bar('in-progress')
        expect(link(html, 'In Arbeit')).toContain('min-w-[4.5rem]')
        expect(link(html, 'Veröffentlicht')).toContain('min-w-[1.5rem]')
        expect(text(html)).not.toMatch(/\d/)
        // The bold form's width is held by an invisible copy of each label.
        expect(html.match(/class="invisible col-start-1 row-start-1 font-semibold"/g)).toHaveLength(3)
    })

    it('scrolls inside itself on a narrow screen, never the page', () => {
        const html = bar('ended')
        expect(html).toMatch(/<nav [^>]*class="[^"]*overflow-x-auto/)
        expect(html).toMatch(/<ul class="[^"]*min-w-max/)
        expect(html).toContain('whitespace-nowrap')
    })

    it('knows the tab of each page, and none for the wizard', () => {
        expect(activeShareTab('/export')).toBe('in-progress')
        expect(activeShareTab('/export/')).toBe('in-progress')
        expect(activeShareTab('/export/shared')).toBe('published')
        expect(activeShareTab('/export/ended')).toBe('ended')
        expect(activeShareTab('/export/new')).toBeUndefined()
        expect(activeShareTab('/')).toBeUndefined()
    })
})

describe('the counts in the tab bar', () => {
    const counts = { inProgress: 4, mine: 2, published: 3 }
    const base = { enabled: true, draftsReady: true, drafts: 1, rows: [], counts }

    it('shows what the tab rules count once everything is read', () => {
        expect(tabCounts(base)).toEqual(counts)
    })

    it('shows none while the browser or GitLab is still read, or when GitLab could not be read', () => {
        expect(tabCounts({ ...base, draftsReady: false })).toBeUndefined()
        expect(tabCounts({ ...base, rows: null })).toBeUndefined()
        expect(tabCounts({ ...base, error: 'GitLab-Fehler (500)' })).toBeUndefined()
    })

    it('counts only the started shares for a person who may not see what was submitted', () => {
        expect(tabCounts({ ...base, enabled: false, rows: [] })).toEqual({ inProgress: 1, mine: 1 })
    })
})

describe('the menu item „Teilen“', () => {
    beforeEach(() => {
        location.pathname = '/'
    })

    const sidebar = () => renderToStaticMarkup(createElement(AppSidebar, { userName: 'Ewa' }))

    it('is one item, with no children of its own', () => {
        location.pathname = '/export'
        const html = sidebar()
        expect(text(html)).not.toContain('Neu teilen')
        expect(text(html)).not.toContain('Geteilte Pakete')
        expect(html.match(/href="\/export[^"]*"/g)).toEqual(['href="/export"'])
    })

    it.each(['/export', '/export/new', '/export/shared', '/export/ended'])('is lit on %s', (pathname) => {
        location.pathname = pathname
        const item = link(sidebar(), 'Teilen')
        expect(item).toContain('aria-current="page"')
        expect(item).toContain('bg-sidebar-accent text-sidebar-accent-foreground')
    })

    it('is not lit elsewhere, and lights nothing else on its pages', () => {
        location.pathname = '/installed'
        expect(link(sidebar(), 'Teilen')).not.toContain('aria-current')
        location.pathname = '/exports'
        expect(link(sidebar(), 'Teilen')).not.toContain('aria-current')
        location.pathname = '/export/shared'
        expect(sidebar().match(/aria-current="page"/g)).toHaveLength(1)
    })

    it('matches below its address only where asked to', () => {
        expect(isNavItemActive({ href: '/export', matchPrefix: true }, '/export/new')).toBe(true)
        expect(isNavItemActive({ href: '/export' }, '/export/new')).toBe(false)
        expect(isNavItemActive({ href: '/', children: [{ title: 'Add-ons', href: '/add-ons' }] }, '/add-ons')).toBe(true)
        expect(isNavItemActive({ href: '/', children: [{ title: 'Add-ons', href: '/add-ons' }] }, '/add-ons/x')).toBe(false)
    })
})
