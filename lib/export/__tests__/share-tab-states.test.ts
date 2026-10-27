import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The pages' notices come with the right check, which would reach for the session.
vi.mock('@/lib/session', () => ({ getAccessToken: vi.fn(async () => 'test-token') }))
// The list's rows ask the server only after a click, which a static render never makes.
vi.mock('@/lib/export-actions', () => ({ deleteShare: vi.fn(), planShareDeletion: vi.fn(), proposeSharedCatalogEntry: vi.fn() }))
vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}))

import { InProgress } from '@/components/export/in-progress'
import { SHARE_PROCESS_STEPS, ShareProcessBlock, shareProcessOpens } from '@/components/export/share-process'
import { ShareListAccess } from '@/components/export/share-tab-frame'
import { EmptyTab, TAB_LEADS } from '@/components/export/share-tab-states'
import type { ShareDraft } from '@/lib/export/share-drafts'
import type { SharedPackageRow } from '@/lib/export/share-listing'
import { LISTING_HIDDEN_BECAUSE } from '@/lib/export/share-permission'
import { shareTabs } from '@/lib/export/share-tabs'

/** What a reader meets: the text, without markup. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const render = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(element)

describe('an empty tab', () => {
    it('says that nothing is in progress, and leads to the wizard in the words of the page’s button', () => {
        const html = render(createElement(EmptyTab, { tab: 'in-progress' }))
        expect(text(html)).toBe('Gerade ist nichts in Arbeit. Was du anfängst oder einreichst, steht hier, bis es im Katalog ist. Neues Paket teilen')
        expect(html).toContain('<a href="/export/new"')
        // A link that looks like text: the button next to the heading stays the page's one primary.
        expect(html).not.toContain('bg-primary')
    })

    it('says that nothing is published, and where to look meanwhile', () => {
        const html = render(createElement(EmptyTab, { tab: 'published' }))
        expect(text(html)).toBe(
            'Von dieser Instanz steht noch nichts im Katalog. Ein Paket kommt hierher, wenn beide Prüfungen durch sind - den Stand siehst du unter „In Arbeit“. Neues Paket teilen',
        )
    })

    it('says only that nothing ended', () => {
        const html = render(createElement(EmptyTab, { tab: 'ended' }))
        expect(text(html)).toBe('Noch nichts beendet.')
        expect(html).not.toContain('<a ')
    })

    it('has a lead for every tab', () => {
        expect(TAB_LEADS['in-progress']).toBe(
            'Was angefangen oder eingereicht ist und noch nicht im Katalog steht. Bei jedem Eintrag steht, wer gerade dran ist. ' +
                'Was das Katalog-Team nicht angenommen hat, bleibt hier 30 Tage lang und steht von Anfang an auch unter „Beendet“.',
        )
        expect(TAB_LEADS.published).toContain('Herausnehmen kann einen Eintrag nur das Katalog-Team.')
        expect(TAB_LEADS.ended).toBe('Was zurückgezogen, nicht angenommen, entfernt oder aus dem Katalog genommen wurde, mit Datum und Namen. Die Angaben kommen aus GitLab, dort bleibt alles erhalten.')
    })
})

describe('the list „In Arbeit“', () => {
    const WEB = 'https://gitlab.example/group/catalog/-/merge_requests'
    const draft = (step: 1 | 2): ShareDraft => ({
        datasetId: 'ds 1',
        datasetName: 'Bäume',
        savedAt: '2026-10-16T12:00:00Z',
        startedAt: '2026-10-12T10:00:00Z',
        step,
        basics: {},
        metadata: { fields: {}, themes: [], media: [] },
        targetKey: 't',
        demoExcluded: [],
    })
    const inReview: SharedPackageRow = {
        key: 't#export/regen-1.0.0',
        targetKey: 't',
        targetLabel: 'Ablage',
        slug: 'regen',
        version: '1.0.0',
        displayName: 'Regen',
        bundleMr: { url: `${WEB}/7`, state: 'opened' },
    }
    const list = (props: Partial<Parameters<typeof InProgress>[0]>) =>
        renderToStaticMarkup(createElement(InProgress, { drafts: [], rows: [], loaded: 1, onReload: () => {}, onDiscard: () => {}, ...props }))

    it('leads a started share back into the wizard, at the step it was saved at', () => {
        const html = list({ drafts: [draft(2)] })
        expect(html).toContain('href="/export/new?source=dataset:ds%201&amp;step=steckbrief"')
        expect(text(html)).toContain('Angefangen am 12.10. - noch nicht eingereicht')
        expect(list({ drafts: [draft(1)] })).toContain('href="/export/new?source=dataset:ds%201&amp;resume=1"')
    })

    it('offers no way on for a started share whose dataset is gone', () => {
        const html = list({ drafts: [draft(2)], datasets: [{ id: 'other', name: 'Andere' }] })
        expect(text(html)).toContain('Der Datensatz „Bäume“ ist auf dieser Instanz nicht mehr da · du bist dran: Zwischenstand verwerfen')
        expect(html).not.toContain('/export/new')
    })

    it('lists every row, with no cut-off and none of the links to the pages the tabs replace', () => {
        const rows = Array.from({ length: 5 }, (_, index) => ({ ...inReview, key: `${inReview.key}-${index}`, displayName: `Regen ${index}` }))
        const html = list({ drafts: [draft(2)], rows: shareTabs(rows).inProgress })
        for (let index = 0; index < 5; index++) expect(text(html)).toContain(`Regen ${index}`)
        expect(html).toContain(`href="${WEB}/7"`)
        expect(text(html)).not.toMatch(/Alle \d+ anzeigen|Weniger anzeigen|Geteilte Pakete|Alle geteilten Pakete/)
        expect(html).not.toContain('/export/shared')
    })

    it('says that nothing is in progress once GitLab answered, and waits for it before', () => {
        expect(text(list({}))).toContain('Gerade ist nichts in Arbeit.')
        expect(text(list({ rows: null }))).toBe('Stand bei GitLab wird abgefragt …')
    })

    it('keeps the started shares when GitLab could not be read, and says so', () => {
        const html = text(list({ drafts: [draft(2)], rows: [], error: 'GitLab-Fehler (500)' }))
        expect(html).toContain('Bäume')
        expect(html).toContain('Was bei GitLab offen ist, ließ sich gerade nicht abfragen (GitLab-Fehler (500)).')
        expect(html).not.toContain('Gerade ist nichts in Arbeit.')
    })
})

describe('why a tab stays empty for a person', () => {
    const access = (tab: 'in-progress' | 'published' | 'ended', readiness: 'ready' | 'missing-targets' | 'missing-token', right?: 'allowed' | 'refused' | 'unknown') =>
        text(render(createElement(ShareListAccess, { tab, readiness, right })))

    it('says that sharing is not set up, and that started shares still show in „In Arbeit“', () => {
        expect(access('in-progress', 'missing-targets')).toBe(
            'Teilen ist auf dieser Instanz noch nicht eingerichtet Einreichen geht erst, wenn der Betrieb einen Ablageort und einen GitLab-Zugang eingerichtet hat. Was du in diesem Browser angefangen hast, steht trotzdem hier.',
        )
        expect(access('published', 'missing-token')).toBe('Teilen ist auf dieser Instanz noch nicht eingerichtet Deshalb gibt es hier noch nichts zu sehen. Das Einrichten übernimmt der Betrieb.')
        expect(access('ended', 'missing-targets')).toContain('Deshalb gibt es hier noch nichts zu sehen.')
    })

    it('says who may see what was submitted, or that the right could not be checked', () => {
        expect(access('in-progress', 'ready', 'refused')).toBe(LISTING_HIDDEN_BECAUSE.refused)
        expect(access('published', 'ready', 'unknown')).toBe(LISTING_HIDDEN_BECAUSE.unknown)
        expect(access('ended', 'ready', undefined)).toBe(LISTING_HIDDEN_BECAUSE.unknown)
    })

    it('says nothing to a person who may see it', () => {
        expect(access('in-progress', 'ready', 'allowed')).toBe('')
    })

    it('is a neutral notice, never a warning or an error', () => {
        const html = render(createElement(ShareListAccess, { tab: 'published', readiness: 'ready', right: 'refused' }))
        expect(html).toContain('bg-muted/40')
        expect(html).not.toMatch(/border-(warn|error)/)
    })
})

describe('„So läuft Teilen ab“', () => {
    const view = { enabled: true, draftsReady: true, rows: [], counts: { inProgress: 0, published: 0 } }

    it('opens by itself only when this instance has nothing in progress and nothing published', () => {
        expect(shareProcessOpens(view)).toBe(true)
        expect(shareProcessOpens({ ...view, counts: { inProgress: 1, published: 0 } })).toBe(false)
        expect(shareProcessOpens({ ...view, counts: { inProgress: 0, published: 2 } })).toBe(false)
        // Without the right to see what was submitted, only the started shares are known.
        expect(shareProcessOpens({ ...view, enabled: false })).toBe(true)
    })

    it('stays folded while the lists load, or when GitLab could not be read', () => {
        expect(shareProcessOpens({ ...view, draftsReady: false })).toBe(false)
        expect(shareProcessOpens({ ...view, rows: null })).toBe(false)
        expect(shareProcessOpens({ ...view, error: 'GitLab-Fehler (500)' })).toBe(false)
    })

    it('names the four steps and what is shared, folded into one line', () => {
        const html = render(createElement(ShareProcessBlock, { open: false }))
        expect(html).toContain('aria-expanded="false"')
        expect(text(html)).toBe(
            'So läuft Teilen ab 01 Datensatz wählen und Steckbrief ergänzen 02 Paket-Prüfung durch das Katalog-Team 03 Katalog-Eintrag vorschlagen ' +
                '04 Eintrags-Prüfung, dann veröffentlicht Geteilt wird der Aufbau, nie die Daten. Dein Name steht im öffentlichen Vorschlag bei GitLab.',
        )
        // Folded content stays in the page to animate, but cannot be reached.
        expect(html).toMatch(/<div id="[^"]+" inert=""/)
        expect(render(createElement(ShareProcessBlock, { open: true }))).toContain('aria-expanded="true"')
        expect(SHARE_PROCESS_STEPS).toHaveLength(4)
    })
})
