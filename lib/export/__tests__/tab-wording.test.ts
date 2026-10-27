import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { strictProblemsOf } from './wording-rules'

// The rows ask the server only after a click, which a static render never makes; no app router runs either.
vi.mock('@/lib/session', () => ({ getAccessToken: vi.fn(async () => 'test-token') }))
vi.mock('@/lib/export-actions', () => ({ deleteShare: vi.fn(), planShareDeletion: vi.fn(), proposeSharedCatalogEntry: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/export' }))
vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}))

import { Ended } from '@/components/export/ended-shares'
import { InProgress } from '@/components/export/in-progress'
import { Published } from '@/components/export/published-shares'
import { ShareProcessBlock } from '@/components/export/share-process'
import { EmptyTab, TAB_LEADS, TAB_TITLES } from '@/components/export/share-tab-states'
import { ShareTabsNav } from '@/components/export/share-tabs-nav'
import { endedLine } from '@/lib/export/ended-lines'
import type { ShareDraft } from '@/lib/export/share-drafts'
import type { ShareProposal, SharedPackageRow } from '@/lib/export/share-listing'
import { shareTabs, type ShareTab } from '@/lib/export/share-tabs'

/**
 * Every tab of "Teilen" rendered with sample data, read as plain text the
 * way a person meets it - with what screen readers hear and the props that
 * become text (`aria-label`, `title`, `placeholder`, `alt`) - and held to
 * the strict wording rules (plan of 2026-10-18, section 8.2 and 8.3): none
 * of the banned words, and the labels each tab is meant to have. The source
 * scan in `wording.test.ts` finds what is written; this finds what is put
 * together from the listing, the stage rules and the line builders.
 */

const HERE = 'https://portal.hier.example'
const THERE = 'https://portal.dev.example'
const WEB = 'https://gitlab.example/group/catalog/-/merge_requests'
const NOW = Date.parse('2026-10-22T12:00:00.000Z')
const ID = 'urn:openurbanapps:usecase:musterbach'

/** What a reader meets: the text without markup, and the props that are read out or shown. */
function readable(html: string): string {
    const props = [...html.matchAll(/\s(?:aria-label|title|placeholder|alt)="([^"]*)"/g)].map((match) => match[1])
    return [html.replace(/<[^>]+>/g, ' '), ...props].join(' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
}

const proposal = (kind: ShareProposal['kind'], iid: number, state: string, extra: Partial<ShareProposal> = {}): ShareProposal => ({ kind, iid, url: `${WEB}/${iid}`, state, ...extra })
const sourced = (slug: string) => ({ source: { kind: 'dataset' as const, id: `ds-${slug}`, instance: HERE } })
const row = (slug: string, version: string, facts: Partial<SharedPackageRow> = {}): SharedPackageRow => ({
    key: `t#export/${slug}-${version}`,
    targetKey: 't',
    targetLabel: 'Katalog-Repo',
    slug,
    version,
    displayName: `Paket ${slug}`,
    bundleMr: { url: `${WEB}/1`, state: 'merged' },
    ...sourced(slug),
    proposedBy: 'Ewa',
    packageId: ID,
    proposals: [proposal('bundle', 1, facts.bundleMr?.state ?? 'merged', { createdAt: '2026-10-12T09:00:00Z', ...sourced(slug) })],
    ...facts,
})
const onBase = (extra: Record<string, unknown> = {}) => ({ state: 'on-base' as const, packageId: ID, verification: { state: 'verified' as const }, ...extra })
const replacedBy = (version: string) => ({ state: 'none' as const, reason: 'other-version' as const, onBase: { id: ID, version } })
const viaAccount = (kind: ShareProposal['kind'], iid: number, closedAt: string, slug: string) =>
    proposal(kind, iid, 'closed', { createdAt: closedAt, closedAt, closedByBot: true, closedBy: 'walkable.cities.2021', reason: { kind: 'none' }, ...sourced(slug) })

/** A listing with something at every stage: what each tab shows of it. */
const ROWS: SharedPackageRow[] = [
    row('pegel', '1.0.0', { bundleMr: { url: `${WEB}/4`, state: 'opened' }, proposals: [proposal('bundle', 4, 'opened', sourced('pegel'))] }),
    row('regen', '1.0.0', { bundle: onBase(), catalog: { state: 'none' } }),
    row('bodenfeuchte', '1.0.0', {
        bundle: onBase(),
        catalog: { state: 'none' },
        proposals: [
            proposal('bundle', 21, 'closed', { closedAt: '2026-10-21T10:00:00Z', closedBy: 'spaudanjo', reason: { kind: 'given', text: 'Doppelt, siehe !19.' }, ...sourced('bodenfeuchte') }),
            proposal('bundle', 19, 'merged', sourced('bodenfeuchte')),
        ],
    }),
    // !31 and !32: the entry of 1.1.4 closed twice through the marketplace's account.
    row('musterbach', '1.1.4', {
        bundle: onBase(),
        catalog: { state: 'declined', mrUrl: `${WEB}/32`, declined: { iid: 32, mrUrl: `${WEB}/32`, closedAt: '2026-10-22T09:41:28Z', viaMarketplace: true, reason: { kind: 'none' } } },
        proposals: [viaAccount('catalog', 32, '2026-10-22T09:41:28Z', 'musterbach'), viaAccount('catalog', 31, '2026-10-22T09:37:23Z', 'musterbach'), proposal('bundle', 30, 'merged', sourced('musterbach'))],
    }),
    row('musterbach', '1.1.3', {
        bundle: replacedBy('1.1.4'),
        catalog: { state: 'listed', maintainer: 'Open Urban Apps' },
        proposals: [proposal('catalog', 20, 'merged', { mergedAt: '2026-10-14T10:00:00Z', ...sourced('musterbach') }), proposal('bundle', 18, 'merged', sourced('musterbach'))],
    }),
    row('musterbach', '1.1.2', {
        bundle: replacedBy('1.1.4'),
        catalog: { state: 'none' },
        proposals: [proposal('catalog', 15, 'merged', sourced('musterbach')), proposal('bundle', 14, 'merged', sourced('musterbach'))],
    }),
    row('kataster', '2.0.0', { bundle: onBase(), catalog: { state: 'listed', maintainer: 'Stadt Musterstadt' }, proposals: [proposal('catalog', 41, 'merged', sourced('kataster')), proposal('bundle', 40, 'merged', sourced('kataster'))] }),
    // Listed at 1.0.0, while 1.1.0 is in review.
    row('teich', '1.1.0', { bundleMr: { url: `${WEB}/44`, state: 'opened' }, proposals: [proposal('bundle', 44, 'opened', sourced('teich'))] }),
    row('teich', '1.0.0', { bundle: onBase(), catalog: { state: 'listed' }, proposals: [proposal('catalog', 43, 'merged', sourced('teich')), proposal('bundle', 42, 'merged', sourced('teich'))] }),
    row('wind', '1.0.0', { problem: 'GitLab-Fehler (500): boom' }),
    row('baeume', '1.1.0', {
        bundleMr: { url: `${WEB}/7`, state: 'closed' },
        withdrawn: true,
        proposals: [proposal('bundle', 7, 'closed', { closedAt: '2026-10-12T09:00:00Z', closedByBot: true, withdrawnBy: 'Ewa', ...sourced('baeume') })],
    }),
    row('see', '1.0.0', {
        bundle: { state: 'none', reason: 'no-package', removal: { state: 'merged', mrUrl: `${WEB}/9` } },
        proposals: [proposal('removal', 9, 'merged', { mergedAt: '2026-10-16T10:00:00Z', mergedBy: 'daniel', proposedBy: 'Ewa', ...sourced('see') }), proposal('bundle', 8, 'merged', sourced('see'))],
    }),
    row('ufer', '1.0.2', { bundle: onBase(), catalog: { state: 'withdrawn', takenOut: { version: '1.0.2', reason: 'Datenquelle abgeschaltet' } } }),
    // !3: closed by hand before rc.6, naming no instance.
    row('kiez', '1.0.0', {
        bundleMr: { url: `${WEB}/3`, state: 'closed' },
        source: undefined,
        proposals: [proposal('bundle', 3, 'closed', { closedAt: '2026-10-11T10:00:00Z', closedByBot: true, closedBy: 'walkable.cities.2021', reason: { kind: 'none' } })],
    }),
    // Another instance's share, through the same account: counted, not listed.
    row('fremd', '1.0.0', { source: { kind: 'dataset', id: 'ds-fremd', instance: THERE }, bundleMr: { url: `${WEB}/50`, state: 'opened' }, proposals: [proposal('bundle', 50, 'opened')] }),
]

const DRAFT: ShareDraft = {
    datasetId: 'ds-neu',
    datasetName: 'Neuer Datensatz',
    savedAt: '2026-10-21T12:00:00Z',
    startedAt: '2026-10-20T10:00:00Z',
    step: 2,
    basics: {},
    metadata: { fields: {}, themes: [], media: [] },
    targetKey: 't',
    demoExcluded: [],
}

const tabs = shareTabs(ROWS, { instance: HERE, person: 'Ewa', drafts: 1, now: NOW })

/** Each tab's list with the sample listing. */
const LISTS: Record<ShareTab, ReactNode> = {
    'in-progress': createElement(InProgress, {
        drafts: [DRAFT],
        rows: tabs.inProgress,
        elsewhere: tabs.elsewhere['in-progress'],
        loaded: 1,
        onReload: () => {},
        onDiscard: () => {},
    }),
    published: createElement(Published, { rows: tabs.published, elsewhere: tabs.elsewhere.published, now: NOW, instance: HERE }),
    ended: createElement(Ended, {
        lines: tabs.ended.map((entry) => ({ key: entry.key, line: endedLine(entry, { rows: ROWS, inProgress: tabs.inProgress, instance: HERE }) })),
        elsewhere: tabs.elsewhere.ended,
        older: `${WEB}?scope=all&state=all&author_username=walkable.cities.2021`,
    }),
}

/** Each tab's page as a person meets it: the tab bar, „So läuft Teilen ab“, the lead and the list. */
function page(tab: ShareTab): string {
    return renderToStaticMarkup(
        createElement(
            Fragment,
            null,
            createElement(ShareTabsNav, { active: tab, counts: { inProgress: tabs.counts.inProgress, published: tabs.counts.published } }),
            createElement(ShareProcessBlock, { open: true }),
            createElement('h2', null, TAB_TITLES[tab]),
            createElement('p', null, TAB_LEADS[tab]),
            LISTS[tab],
        ),
    )
}

const PAGES: Record<ShareTab, string> = { 'in-progress': page('in-progress'), published: page('published'), ended: page('ended') }

/** What each tab is meant to say, at least. */
const LABELS: Record<ShareTab, string[]> = {
    'in-progress': [
        'Du bist dran',
        'Wartet auf andere',
        'Stand nicht lesbar',
        'Weitermachen',
        'Verwerfen',
        'Katalog-Eintrag vorschlagen',
        'Neue Version teilen',
        'Zurückziehen',
        'In GitLab ansehen',
        'Erneut versuchen',
        'Über das Marktplatz-Konto geschlossen, ohne Begründung.',
        'Vorschlag ansehen',
        '1 weiterer Eintrag stammt von einer anderen Instanz.',
    ],
    published: [
        'Seit 14.10. im Katalog · eingereicht von Ewa · Herausgeber: Open Urban Apps',
        'Frühere Versionen im Katalog: 1.1.2',
        // !31 and !32: what 1.1.4 stands at is a "no", not progress.
        'Katalog-Eintrag für 1.1.4 nicht angenommen',
        'Version 1.1.0 ist in Arbeit',
        'Im Katalog ansehen',
        'In GitLab ansehen',
        'Neue Version teilen',
    ],
    ended: [
        'Paket · Zurückgezogen',
        'Katalog-Eintrag · Nicht angenommen',
        'Paket · Nicht angenommen',
        'Paket · Entfernt',
        'Änderung am Paket · Nicht angenommen',
        'Aus dem Katalog genommen',
        'über das Marktplatz-Konto',
        'Ohne Begründung.',
        'Grund: „Doppelt, siehe !19.“',
        'Grund: Datenquelle abgeschaltet.',
        'Vorschlag !32',
        'vorgeschlagen von Ewa, angenommen von daniel',
        'Instanz unbekannt',
        'Erneut einreichen',
        'Neue Version teilen',
        'In GitLab ansehen',
        'Ältere in GitLab ansehen',
    ],
}

describe('every tab of „Teilen“, rendered to plain text', () => {
    it.each(Object.keys(PAGES) as ShareTab[])('%s says none of the banned words', (tab) => {
        const said = readable(PAGES[tab])
        // Every rule, on the whole page and on each sentence the page is made of.
        expect(strictProblemsOf(said)).toEqual([])
        expect(said).not.toMatch(/Use Case|\bMR\b|Merge Request|Branch|Repositor|Repo\b|Dataset|gemergt|index\.json|urn:|—|–|Löschen/)
    })

    it.each(Object.keys(PAGES) as ShareTab[])('%s has the labels it is meant to', (tab) => {
        const said = readable(PAGES[tab])
        for (const label of LABELS[tab]) expect(said, label).toContain(label)
    })

    it('shows each share in the tab it belongs in, and another instance’s nowhere but in a count', () => {
        expect(readable(PAGES.published)).not.toContain('Paket pegel')
        expect(readable(PAGES['in-progress'])).toContain('Paket pegel')
        expect(Object.values(PAGES).some((html) => readable(html).includes('Paket fremd'))).toBe(false)
        // „Veröffentlicht“ has none of the old chips, nor the entry proposal, which belongs to „In Arbeit“.
        expect(readable(renderToStaticMarkup(createElement(Fragment, null, LISTS.published)))).not.toMatch(/Paket: |Entfernen: |Stand: |Eintrag in Prüfung|Katalog-Eintrag vorschlagen|\bv\d/)
    })

    it('says the empty states and the leads in the same words', () => {
        for (const tab of Object.keys(PAGES) as ShareTab[]) {
            const said = readable(renderToStaticMarkup(createElement(Fragment, null, createElement(EmptyTab, { tab }), createElement('p', null, TAB_LEADS[tab]))))
            expect(strictProblemsOf(said), tab).toEqual([])
        }
    })
})
