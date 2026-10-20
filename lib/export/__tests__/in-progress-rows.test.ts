import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The rows ask the server only after a click, which a static render never makes.
vi.mock('@/lib/session', () => ({ getAccessToken: vi.fn(async () => 'test-token') }))
vi.mock('@/lib/export-actions', () => ({ deleteShare: vi.fn(), planShareDeletion: vi.fn(), proposeSharedCatalogEntry: vi.fn() }))
vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}))

import { elsewhereLine, InProgress } from '@/components/export/in-progress'
import { ShareTrack } from '@/components/export/share-track'
import type { ShareProposal, SharedPackageRow } from '@/lib/export/share-listing'
import { shareTabs } from '@/lib/export/share-tabs'

const HERE = 'https://portal.hier.example'
const WEB = 'https://gitlab.example/group/catalog/-/merge_requests'

/** What a reader meets: the text, without markup. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])

/** The markup a screen reader meets: every element marked aria-hidden left out, with all it holds. */
function heard(html: string): string {
    let out = ''
    let at = 0
    let hiddenDepth = 0
    const stack: boolean[] = []
    for (const match of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
        const [tag, closing, name, attributes, selfClosing] = match
        const index = match.index ?? 0
        if (hiddenDepth === 0) out += html.slice(at, index)
        at = index + tag.length
        if (closing) {
            if (stack.pop()) hiddenDepth--
            else if (hiddenDepth === 0) out += tag
            continue
        }
        const hides = /aria-hidden="true"/.test(attributes)
        if (selfClosing || VOID.has(name.toLowerCase())) {
            if (hiddenDepth === 0 && !hides) out += tag
            continue
        }
        if (hides) hiddenDepth++
        else if (hiddenDepth === 0) out += tag
        stack.push(hides)
    }
    return out + (hiddenDepth === 0 ? html.slice(at) : '')
}

const proposal = (kind: ShareProposal['kind'], iid: number, state: string, extra: Partial<ShareProposal> = {}): ShareProposal => ({ kind, iid, url: `${WEB}/${iid}`, state, ...extra })

const row = (slug: string, facts: Partial<SharedPackageRow> = {}): SharedPackageRow => ({
    key: `t#export/${slug}-1.1.0`,
    targetKey: 't',
    targetLabel: 'Ablage',
    slug,
    version: '1.1.0',
    displayName: `Paket ${slug}`,
    bundleMr: { url: `${WEB}/31`, state: 'merged' },
    source: { kind: 'dataset', id: `ds-${slug}`, instance: HERE },
    proposedBy: 'Ewa',
    proposals: [proposal('bundle', 31, facts.bundleMr?.state ?? 'merged', { createdAt: '2026-10-12T09:00:00.000Z' })],
    ...facts,
})
const onBase = (extra: Record<string, unknown> = {}) => ({ state: 'on-base' as const, packageId: 'urn:x:usecase:a', verification: { state: 'verified' as const }, ...extra })

const list = (rows: SharedPackageRow[], props: Partial<Parameters<typeof InProgress>[0]> = {}, person = 'Ewa') =>
    renderToStaticMarkup(
        createElement(InProgress, {
            drafts: [],
            rows: shareTabs(rows, { instance: HERE, person }).inProgress,
            datasets: [{ id: 'ds-baeume', name: 'Baumkataster Mitte' }],
            loaded: 1,
            onReload: () => {},
            onDiscard: () => {},
            ...props,
        }),
    )

describe('the progress line', () => {
    const html = renderToStaticMarkup(
        createElement(ShareTrack, {
            steps: [
                { label: 'Einreichen', mark: 'done' },
                { label: 'Paket-Prüfung', mark: 'done' },
                { label: 'Katalog-Eintrag', mark: 'yours' },
                { label: 'Eintrags-Prüfung', mark: 'later' },
            ],
        }),
    )

    it('is hidden from screen readers as a whole', () => {
        expect(html.startsWith('<div aria-hidden="true"')).toBe(true)
        expect(heard(html)).toBe('')
    })

    it('shows one mark per step, the person’s step in the text colour and its label in bold', () => {
        expect([...html.matchAll(/data-mark="(\w+)"/g)].map((match) => match[1])).toEqual(['done', 'done', 'yours', 'later'])
        expect(html).toContain('border-[3px] border-foreground')
        expect(html).not.toContain('primary')
        expect(html).toMatch(/font-semibold text-foreground">Katalog-Eintrag</)
        // Left out at phone width, where four labels do not fit.
        expect(html).toMatch(/hidden pr-2 text-xs leading-snug sm:block[^"]*">Einreichen</)
    })
})

describe('a row of „In Arbeit“', () => {
    it('says where it stands in a sentence a screen reader hears, with the line beside it for the eye', () => {
        const html = list([row('baeume', { bundle: onBase(), catalog: { state: 'none' } })])
        const sentence = 'Katalog-Eintrag (3 von 4) - du bist dran'
        expect(text(heard(html))).toContain(sentence)
        // The labels under the marks are not heard: the sentence says it once.
        expect(text(heard(html))).not.toContain('Einreichen')
        expect(text(html)).toContain('Einreichen Paket-Prüfung Katalog-Eintrag Eintrags-Prüfung')
        expect(text(heard(html))).toContain('Paket baeume Version 1.1.0')
        expect(text(heard(html))).toContain('aus Datensatz „Baumkataster Mitte“ · eingereicht am 12.10. von Ewa')
    })

    it('offers the person’s move as a secondary button, with the quiet ways on and out before it', () => {
        const html = list([row('baeume', { bundle: onBase(), catalog: { state: 'none' } })])
        expect(text(heard(html))).toMatch(/Neue Version teilen Zurückziehen Katalog-Eintrag vorschlagen$/)
        expect(html).toContain('href="/export/new?source=dataset:ds-baeume"')
        // One primary per surface, and that is „Neues Paket teilen“ next to the heading.
        expect(html).not.toContain('bg-primary')
    })

    it('names the colleague whose move it is', () => {
        const html = list([row('baeume', { bundle: onBase(), catalog: { state: 'none' } })], {}, 'Kim')
        expect(text(html)).toContain('Katalog-Eintrag (3 von 4) - Ewa ist dran')
        expect(text(html)).not.toContain('du bist dran')
    })

    it('leads a stage that waits for the catalogue team to its proposal at GitLab, not to a button', () => {
        const html = list([row('regen', { bundleMr: { url: `${WEB}/31`, state: 'opened' } })])
        expect(text(html)).toContain('Paket-Prüfung (2 von 4) - wartet auf das Katalog-Team · Vorschlag !31')
        expect(html).toMatch(new RegExp(`<a href="${WEB}/31" target="_blank"[^>]*>In GitLab ansehen`))
        expect(html).not.toContain('border px-3 py-1.5')
    })

    it('shows a removal without a progress line, in one line with the undo mark', () => {
        const html = list([row('alt', { bundle: onBase({ removal: { state: 'opened', mrUrl: `${WEB}/40` } }), catalog: { state: 'none' } })])
        expect(html).not.toContain('data-mark=')
        expect(text(html)).toContain('Entfernen vorgeschlagen - wartet auf das Katalog-Team')
        expect(html).toContain('lucide-undo2')
        expect(html).toContain(`href="${WEB}/40"`)
    })

    it('says that a state could not be read, and offers to read again', () => {
        const html = list([row('kaputt', { problem: 'GitLab-Fehler (500)' })])
        expect(text(html)).toContain('Der Stand ließ sich nicht lesen: GitLab-Fehler (500) Erneut versuchen')
        expect(html).not.toContain('data-mark=')
        expect(text(html)).not.toContain('Zurückziehen')
    })

    it('lists earlier versions, muted', () => {
        const earlier = row('baeume', { key: 't#export/baeume-1.0.0', version: '1.0.0', bundle: { state: 'none', reason: 'other-version', onBase: { id: 'urn:x:usecase:a', version: '1.1.0' } } })
        const html = list([row('baeume', { bundle: onBase(), catalog: { state: 'none' } }), earlier])
        expect(html).toContain('<p class="text-xs text-muted-foreground">Frühere Versionen: 1.0.0</p>')
    })
})

describe('around the rows of „In Arbeit“', () => {
    it('counts what other instances have in progress in one line', () => {
        expect(elsewhereLine(1)).toBe('1 weiterer Eintrag stammt von einer anderen Instanz.')
        expect(elsewhereLine(2)).toBe('2 weitere Einträge stammen von anderen Instanzen.')
        expect(text(list([row('baeume', { bundleMr: { url: `${WEB}/31`, state: 'opened' } })], { elsewhere: 2 }))).toContain(
            '2 weitere Einträge stammen von anderen Instanzen.',
        )
        // Also when nothing of this instance is in progress.
        const empty = text(list([], { elsewhere: 1 }))
        expect(empty).toContain('Gerade ist nichts in Arbeit.')
        expect(empty).toContain('1 weiterer Eintrag stammt von einer anderen Instanz.')
    })

    it('says that GitLab could not be read, with „Erneut versuchen“', () => {
        const html = text(list([], { rows: [], error: 'GitLab-Fehler (502)' }))
        expect(html).toBe('Was bei GitLab offen ist, ließ sich gerade nicht abfragen (GitLab-Fehler (502)). Erneut versuchen')
    })
})
