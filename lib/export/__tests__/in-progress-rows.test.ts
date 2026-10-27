import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The rows ask the server only after a click, which a static render never makes.
vi.mock('@/lib/session', () => ({ getAccessToken: vi.fn(async () => 'test-token') }))
vi.mock('@/lib/export-actions', () => ({ deleteShare: vi.fn(), planShareDeletion: vi.fn(), proposeSharedCatalogEntry: vi.fn() }))
vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}))

import { InProgress } from '@/components/export/in-progress'
import { elsewhereLine } from '@/components/export/share-tab-states'
import { ShareTrack } from '@/components/export/share-track'
import type { ShareDraft } from '@/lib/export/share-drafts'
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

/** The card of one row, by its title: what the rows say, apart from the group headings around them. */
function card(html: string, title: string): string {
    const found = [...html.matchAll(/<li(?: id="[^"]*" tabindex="-1")? class="flex flex-col gap-3 rounded-lg[^"]*">[\s\S]*?<\/li>/g)].find((match) => text(match[0]).includes(title))
    if (!found) throw new Error(`no row "${title}" in ${html}`)
    return found[0]
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

/** When the tests read the listing: a "no" is measured against it. */
const NOW = Date.parse('2026-10-22T12:00:00.000Z')

const list = (rows: SharedPackageRow[], props: Partial<Parameters<typeof InProgress>[0]> = {}, person = 'Ewa') =>
    renderToStaticMarkup(
        createElement(InProgress, {
            drafts: [],
            rows: shareTabs(rows, { instance: HERE, person, now: NOW }).inProgress,
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
        const sentence = 'Katalog-Eintrag (3 von 4) - Paket angenommen · du bist dran: Katalog-Eintrag vorschlagen'
        expect(text(heard(html))).toContain(sentence)
        // The labels under the marks are not heard: the sentence says it once.
        expect(text(heard(html))).not.toContain('Einreichen')
        expect(text(html)).toContain('Einreichen Paket-Prüfung Katalog-Eintrag Eintrags-Prüfung')
        expect(text(heard(html))).toContain('Paket baeume Version 1.1.0')
        expect(text(heard(html))).toContain('aus Datensatz „Baumkataster Mitte“ · eingereicht am 12.10. von Ewa')
    })

    it('offers the person’s move as a secondary button, with the quiet ways on and out before it', () => {
        const html = list([row('baeume', { bundle: onBase(), catalog: { state: 'none' } })])
        expect(text(heard(card(html, 'Paket baeume')))).toMatch(/Neue Version teilen Zurückziehen Katalog-Eintrag vorschlagen$/)
        // The new version starts from this one: the wizard fills its Steckbrief from it (rc.7).
        expect(html).toContain('href="/export/new?source=dataset:ds-baeume&amp;from=1.1.0&amp;package=baeume"')
        // The card can be linked to, from the wizard's notice for a busy dataset - and takes the focus a link to it gives.
        expect(html).toMatch(/<li id="in-arbeit-baeume-1\.1\.0-[a-z0-9]+" tabindex="-1" class=/)
        // One primary per surface, and that is „Neues Paket teilen“ next to the heading.
        expect(html).not.toContain('bg-primary')
    })

    it('names the colleague whose move it is', () => {
        const html = list([row('baeume', { bundle: onBase(), catalog: { state: 'none' } })], {}, 'Kim')
        expect(text(html)).toContain('Katalog-Eintrag (3 von 4) - Paket angenommen · Ewa ist dran: Katalog-Eintrag vorschlagen')
        expect(text(html)).not.toContain('du bist dran')
    })

    it('says why a proposal that would bring back a taken-out version should go, and offers „Zurückziehen“ for it', () => {
        const html = list([row('baeume', { bundle: onBase(), catalog: { state: 'mr-open', mrUrl: `${WEB}/29`, takenOut: { version: '1.1.0' }, bringsBack: true } })])
        expect(text(heard(html))).toContain(
            'Eintrags-Prüfung (4 von 4) - das Katalog-Team hat diese Version aus dem Katalog genommen, der offene Vorschlag würde sie zurückbringen · du bist dran: Vorschlag zurückziehen Vorschlag ansehen',
        )
        expect(text(heard(card(html, 'Paket baeume')))).toMatch(/Zurückziehen$/)
        expect(html).toContain('lucide-undo2')
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

describe('a "no" in a row of „In Arbeit“ (2026-10-22)', () => {
    /** Closed by the catalogue team the day before, from this instance. */
    const turnedDown = (kind: ShareProposal['kind'], iid: number, extra: Partial<ShareProposal> = {}) =>
        proposal(kind, iid, 'closed', {
            closedAt: '2026-10-21T10:00:00.000Z',
            closedBy: 'spaudanjo',
            reason: { kind: 'given', text: 'Die Datenquelle ist nicht öffentlich.' },
            source: { kind: 'dataset', id: 'ds-x', instance: HERE },
            ...extra,
        })
    const merged = proposal('bundle', 30, 'merged', { createdAt: '2026-10-12T09:00:00.000Z' })

    it('says what the team said in the sentence’s size and colour, before the actions, with the proposal to look at (S1)', () => {
        const html = card(list([row('pegel', { bundleMr: { url: `${WEB}/14`, state: 'closed' }, proposals: [turnedDown('bundle', 14)] })]), 'Paket pegel')
        const heardText = text(heard(html))
        expect(heardText).toContain('Paket-Prüfung (2 von 4) - nicht angenommen am 21.10. · du bist dran: Grund lesen und eine neue Version teilen')
        expect(heardText).toMatch(/Grund \(spaudanjo\): „Die Datenquelle ist nicht öffentlich\.“ Vorschlag ansehen \(!14\) Neue Version teilen$/)
        // Seen without the number, which only a screen reader needs.
        expect(text(html)).toContain('„Die Datenquelle ist nicht öffentlich.“ Vorschlag ansehen (!14)')
        expect(html).toMatch(/Vorschlag ansehen<span class="sr-only"> \(!14\)<\/span>/)
        expect(html).toMatch(/<p class="break-words text-sm leading-relaxed text-foreground">Grund \(spaudanjo\)/)
        expect(html).toContain(`href="${WEB}/14"`)
        // The problem mark on the step turned down; the way on is a secondary button, never the page's primary.
        expect([...html.matchAll(/data-mark="(\w+)"/g)].map((match) => match[1])).toEqual(['done', 'problem', 'later', 'later'])
        expect(html).not.toContain('bg-primary')
    })

    it('tells the entry closed through the marketplace’s account as such, and offers no entry for that version again (S5, S10: !31 and !32)', () => {
        const viaAccount = (iid: number, closedAt: string) =>
            proposal('catalog', iid, 'closed', { closedAt, closedByBot: true, closedBy: 'walkable.cities.2021', comments: 0, reason: { kind: 'none' }, source: { kind: 'dataset', id: 'ds-x', instance: HERE } })
        const musterbach = row('jungbaumbewaesserung-musterbach', {
            version: '1.1.4',
            displayName: 'Jungbaumbewässerung Musterbach',
            bundle: onBase(),
            catalog: { state: 'declined', mrUrl: `${WEB}/32`, declined: { iid: 32, mrUrl: `${WEB}/32`, closedAt: '2026-10-22T09:41:28Z', viaMarketplace: true, reason: { kind: 'none' } } },
            proposals: [viaAccount(32, '2026-10-22T09:41:28Z'), viaAccount(31, '2026-10-22T09:37:23Z'), merged],
        })
        const html = card(list([musterbach]), 'Jungbaumbewässerung Musterbach')
        expect(text(heard(html))).toContain(
            'Eintrags-Prüfung (4 von 4) - nicht angenommen am 22.10. · du bist dran: bei Bedarf eine neue Version teilen Über das Marktplatz-Konto geschlossen, ohne Begründung. Vorschlag ansehen (!32)',
        )
        expect(text(html)).not.toContain('Katalog-Team')
        expect(text(html)).not.toContain('Katalog-Eintrag vorschlagen')
        expect(text(heard(html))).toMatch(/Zurückziehen Neue Version teilen$/)
    })

    it('shows a removal turned down without a progress line, with the neutral mark (S8)', () => {
        const html = card(
            list([
                row('regen', {
                    bundle: onBase({ removal: { state: 'closed', mrUrl: `${WEB}/40`, declined: { iid: 40, mrUrl: `${WEB}/40`, closedAt: '2026-10-21T10:00:00.000Z', reason: { kind: 'none' } } } }),
                    catalog: { state: 'none' },
                    proposals: [turnedDown('removal', 40, { reason: { kind: 'none' } }), merged],
                }),
            ]),
            'Paket regen',
        )
        expect(html).not.toContain('data-mark=')
        expect(html).toContain('lucide-info')
        // Without a reason nothing is there to read: the move is what the row offers.
        expect(text(heard(html))).toContain(
            'Entfernen am 21.10. nicht angenommen - das Paket bleibt angenommen, im Katalog steht es nicht · du bist dran: Katalog-Eintrag vorschlagen oder eine neue Version teilen Ohne Begründung. Vorschlag ansehen (!40)',
        )
        expect(text(heard(html))).toMatch(/Katalog-Eintrag vorschlagen Neue Version teilen$/)
    })

    it('tells two links to proposals in one card apart for a screen reader: the "no" the row stands at, and one to a change (S5 with S4)', () => {
        const html = card(
            list([
                row('boden', {
                    bundle: onBase(),
                    catalog: { state: 'declined', mrUrl: `${WEB}/60`, declined: { iid: 60, mrUrl: `${WEB}/60`, closedAt: '2026-10-21T10:00:00.000Z', reason: { kind: 'none' } } },
                    proposals: [turnedDown('catalog', 60, { reason: { kind: 'none' } }), turnedDown('bundle', 21), merged],
                }),
            ]),
            'Paket boden',
        )
        const heardText = text(heard(html))
        expect(heardText).toContain('Ohne Begründung. Vorschlag ansehen (!60)')
        expect(heardText).toContain('Die Änderung an Version 1.1.0 (Vorschlag !21) hat das Katalog-Team am 21.10. nicht angenommen.')
        expect(heardText).toContain('Vorschlag ansehen (!21)')
    })
})

describe('the groups of „In Arbeit“', () => {
    const accepted = (slug: string, proposedBy = 'Ewa') => row(slug, { bundle: onBase(), catalog: { state: 'none' }, proposedBy })
    const waiting = (slug: string) => row(slug, { bundleMr: { url: `${WEB}/31`, state: 'opened' } })

    it('heads each group with a real heading and its count, the rows’ titles one below it, each group a list of its own', () => {
        const html = list([accepted('mine'), accepted('kims', 'Kim'), waiting('regen'), row('kaputt', { problem: 'GitLab-Fehler (500)' })])
        const headings = [...html.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)].map((match) => text(match[1]))
        expect(headings).toEqual(['Du bist dran · 1 , 1 Eintrag', 'Wartet auf andere · 2 , 2 Einträge', 'Stand nicht lesbar · 1 , 1 Eintrag'])
        // Heard without the dot: „Du bist dran, 1 Eintrag“.
        expect(text(heard(html))).toContain('Du bist dran , 1 Eintrag Hier liegt der nächste Schritt bei dir - in jeder Zeile steht, welcher.')
        expect(text(html)).toContain(
            'Wartet auf andere · 2 , 2 Einträge Hier ist gerade jemand anderes dran - meist das Katalog-Team, manchmal jemand aus deiner Instanz oder der Betrieb. In jeder Zeile steht, woran es hängt.',
        )
        expect(html.match(/<h4 /g)).toHaveLength(4)
        expect(html.match(/<ul /g)).toHaveLength(3)
        // The person's move first, then a colleague's, then the catalogue team's, then what could not be read.
        expect([...html.matchAll(/<h4[^>]*>(.*?)<\/h4>/g)].map((match) => text(match[1]))).toEqual([
            'Paket mine Version 1.1.0',
            'Paket kims Version 1.1.0',
            'Paket regen Version 1.1.0',
            'Paket kaputt Version 1.1.0',
        ])
    })

    it('says that nothing waits for the person once GitLab answered, and leaves out „Stand nicht lesbar“ when all could be read', () => {
        const html = list([waiting('regen')])
        expect([...html.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)].map((match) => text(match[1]))).toEqual(['Du bist dran · 0 , 0 Einträge', 'Wartet auf andere · 1 , 1 Eintrag'])
        // No lead over nothing.
        expect(text(html)).not.toContain('Hier liegt der nächste Schritt')
        expect(text(html)).not.toContain('Stand nicht lesbar')
    })

    it('counts nothing it does not know: while GitLab is asked, or when it could not be read, only the groups with rows show', () => {
        const draft: ShareDraft = {
            datasetId: 'ds-baeume',
            datasetName: 'Baumkataster Mitte',
            savedAt: '2026-10-16T12:00:00Z',
            startedAt: '2026-10-12T10:00:00Z',
            step: 2,
            basics: {},
            metadata: { fields: {}, themes: [], media: [] },
            targetKey: 't',
            demoExcluded: [],
        }
        // No count either, as the tab bar shows none then: one of the started shares alone would be too low.
        for (const props of [{ rows: null }, { rows: [], error: 'GitLab-Fehler (502)' }]) {
            const html = list([], { drafts: [draft], ...props })
            expect([...html.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)].map((match) => text(match[1]))).toEqual(['Du bist dran'])
        }
        // Without the right to see what was submitted, the started shares are all there is: counted, but nothing said of others.
        const own = list([], { drafts: [draft], rows: [], known: 'own' })
        expect([...own.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)].map((match) => text(match[1]))).toEqual(['Du bist dran · 1 , 1 Eintrag'])
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
