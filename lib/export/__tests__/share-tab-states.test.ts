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

import { EndedRow } from '@/components/export/ended-shares'
import { InProgress } from '@/components/export/in-progress'
import { SHARE_PROCESS_STEPS, ShareProcessBlock, shareProcessOpens } from '@/components/export/share-process'
import { ShareListAccess } from '@/components/export/share-tab-frame'
import { EmptyTab, TAB_LEADS } from '@/components/export/share-tab-states'
import { endedLine } from '@/lib/export/ended-lines'
import type { ShareDraft } from '@/lib/export/share-drafts'
import type { ShareProposal, SharedPackageRow } from '@/lib/export/share-listing'
import { LISTING_HIDDEN_BECAUSE } from '@/lib/export/share-permission'
import { shareTabs, type EndedEntry } from '@/lib/export/share-tabs'

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
        expect(TAB_LEADS['in-progress']).toBe('Was angefangen oder eingereicht ist und noch nicht im Katalog steht. Bei jedem Eintrag steht, wer gerade dran ist.')
        expect(TAB_LEADS.published).toContain('Herausnehmen kann einen Eintrag nur das Katalog-Team.')
        expect(TAB_LEADS.ended).toContain('Was du nur angefangen und verworfen hast, steht hier nicht')
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
        expect(text(html)).toContain('Der Datensatz „Bäume“ ist auf dieser Instanz nicht mehr da.')
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

describe('a row of „Beendet“', () => {
    const WEB = 'https://gitlab.example/group/catalog/-/merge_requests'
    const row: SharedPackageRow = {
        key: 't#export/baeume-1.1.0',
        targetKey: 't',
        targetLabel: 'Ablage',
        slug: 'baeume',
        version: '1.1.0',
        displayName: 'Bäume',
        bundleMr: { url: `${WEB}/4`, state: 'closed' },
    }
    const proposal = (extra: Partial<ShareProposal>): ShareProposal => ({ kind: 'bundle', iid: 4, url: `${WEB}/4`, state: 'closed', ...extra })
    const entry = (extra: Partial<EndedEntry>): EndedEntry => ({ key: 'k', ending: 'withdrawn', what: 'bundle', row, version: '1.1.0', origin: 'this', ...extra })

    it('says what ended, how, when and through whom', () => {
        const line = endedLine(entry({ proposal: proposal({ withdrawnBy: 'Ewa', closedAt: '2026-10-12T09:00:00Z' }), at: '2026-10-12T09:00:00Z' }))
        expect(line).toEqual({ title: 'Bäume', version: '1.1.0', what: 'Paket', ending: 'Zurückgezogen', when: '12.10.2026', who: 'von Ewa', url: `${WEB}/4` })
        const html = render(createElement('ul', null, createElement(EndedRow, { line })))
        expect(text(html)).toBe('Bäume Version 1.1.0 Paket · Zurückgezogen 12.10.2026 · von Ewa In GitLab ansehen')
        expect(html).toContain(`href="${WEB}/4"`)
    })

    it('names reviewers by GitLab username, and the marketplace’s account as such', () => {
        expect(endedLine(entry({ ending: 'not-accepted', proposal: proposal({ closedBy: 'daniel' }) })).who).toBe('von daniel')
        expect(endedLine(entry({ ending: 'not-accepted', proposal: proposal({ closedBy: 'oua-bot', closedByBot: true }) })).who).toBe('über das Marktplatz-Konto')
    })

    it('names who proposed and who accepted a removal, and a removal by hand', () => {
        const removal = proposal({ kind: 'removal', iid: 9, url: `${WEB}/9`, state: 'merged', proposedBy: 'Ewa', mergedBy: 'daniel', mergedAt: '2026-10-14T12:00:00Z' })
        expect(endedLine(entry({ ending: 'removed', what: 'removal', proposal: removal, at: removal.mergedAt }))).toMatchObject({
            what: 'Entfernen',
            ending: 'Entfernt',
            when: '14.10.2026',
            who: 'vorgeschlagen von Ewa, angenommen von daniel',
            url: `${WEB}/9`,
        })
        const byHand = endedLine(entry({ ending: 'removed', what: 'version', byHand: true }))
        expect(byHand).toMatchObject({ ending: 'Entfernt', when: 'Datum unbekannt', who: 'von Hand bei GitLab', url: `${WEB}/4` })
        expect(byHand.what).toBeUndefined()
    })

    it('says that the catalogue team took a version out, with their reason', () => {
        const line = endedLine(entry({ ending: 'taken-out', what: 'version', version: '1.0.2', reason: 'Doppelt eingetragen' }))
        expect(line).toMatchObject({ version: '1.0.2', ending: 'Aus dem Katalog genommen', when: 'Datum unbekannt', who: 'Katalog-Team', reason: 'Doppelt eingetragen' })
        expect(text(render(createElement(EndedRow, { line })))).toContain('Grund: Doppelt eingetragen')
    })

    it('leaves out whom nobody can tell', () => {
        expect(endedLine(entry({ proposal: proposal({}) })).who).toBeUndefined()
        expect(text(render(createElement(EndedRow, { line: endedLine(entry({})) })))).toBe('Bäume Version 1.1.0 Paket · Zurückgezogen Datum unbekannt In GitLab ansehen')
    })
})
