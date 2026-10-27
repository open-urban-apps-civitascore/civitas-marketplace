import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The list reads the share pages' listing through the provider, which a static render of `Published` never does.
vi.mock('@/lib/session', () => ({ getAccessToken: vi.fn(async () => 'test-token') }))
vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}))

import { Published, PublishedRow } from '@/components/export/published-shares'
import { inProgressHref } from '@/lib/export/in-progress-items'
import { publishedLine } from '@/lib/export/published-lines'
import type { ShareProposal, SharedPackageRow } from '@/lib/export/share-listing'
import { shareTabs } from '@/lib/export/share-tabs'

const HERE = 'https://portal.hier.example'
const WEB = 'https://gitlab.example/group/catalog/-/merge_requests'
const ID = 'urn:openurbanapps:usecase:jungbaumbewaesserung-musterbach'
/** When the tests read the listing. */
const NOW = Date.parse('2026-10-22T12:00:00.000Z')

/** What a reader meets: the text, without markup. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const render = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(element)

const proposal = (kind: ShareProposal['kind'], iid: number, state: string, extra: Partial<ShareProposal> = {}): ShareProposal => ({ kind, iid, url: `${WEB}/${iid}`, state, ...extra })
/** The entry proposal that brought a version into the catalogue. */
const entry = (iid: number, mergedAt = '2026-10-14T10:00:00Z') => proposal('catalog', iid, 'merged', { mergedAt, mergedBy: 'spaudanjo' })

/** One version of „Jungbaumbewässerung Musterbach“ as the listing reads it; from this instance by Ewa unless said otherwise. */
const row = (version: string, facts: Partial<SharedPackageRow> = {}): SharedPackageRow => ({
    key: `t#export/musterbach-${version}`,
    targetKey: 't',
    targetLabel: 'Ablage',
    slug: 'musterbach',
    version,
    displayName: 'Jungbaumbewässerung Musterbach',
    bundleMr: { url: `${WEB}/1`, state: 'merged' },
    source: { kind: 'dataset', id: 'ds-musterbach', instance: HERE },
    proposedBy: 'Ewa',
    packageId: ID,
    proposals: [proposal('bundle', 1, 'merged')],
    ...facts,
})
const onBase = { state: 'on-base' as const, packageId: ID, verification: { state: 'verified' as const } }
const replacedBy = (version: string) => ({ state: 'none' as const, reason: 'other-version' as const, onBase: { id: ID, version } })
const listed = (version: string, iid: number, facts: Partial<SharedPackageRow> = {}) =>
    row(version, { bundle: onBase, catalog: { state: 'listed', maintainer: 'Open Urban Apps' }, proposals: [entry(iid), proposal('bundle', 1, 'merged')], ...facts })

const published = (rows: SharedPackageRow[]) => shareTabs(rows, { instance: HERE, person: 'Ewa', now: NOW }).published
/** How the page reads a row: against the reading, at this instance. */
const AT = { now: NOW, instance: HERE }

describe('a row of „Veröffentlicht“', () => {
    it('says since when it is in the catalogue, who submitted it and the Herausgeber, and leads to it and to a new version', () => {
        const [tabbed] = published([listed('1.1.3', 20)])
        expect(publishedLine(tabbed, AT)).toEqual({
            title: 'Jungbaumbewässerung Musterbach',
            version: '1.1.3',
            facts: 'Seit 14.10. im Katalog · eingereicht von Ewa · Herausgeber: Open Urban Apps',
            catalogHref: '/use-cases/openurbanapps/jungbaumbewaesserung-musterbach',
            gitlabHref: `${WEB}/20`,
            next: { kind: 'new-version', href: '/export/new?source=dataset:ds-musterbach&from=1.1.3&package=musterbach' },
        })
    })

    it('names the year of an older listing, and leaves out what nobody can tell', () => {
        const [tabbed] = published([listed('1.1.3', 20, { proposals: [entry(20, '2025-03-01T10:00:00Z'), proposal('bundle', 1, 'merged')] })])
        expect(publishedLine(tabbed, AT).facts).toBe('Seit 01.03.2025 im Katalog · eingereicht von Ewa · Herausgeber: Open Urban Apps')
        // Without the reading's time, always with the year.
        expect(publishedLine(published([listed('1.1.3', 20)])[0], { instance: HERE }).facts).toContain('Seit 14.10.2026 im Katalog')
        // Listed without the marketplace's own entry proposal, by nobody named, under no Herausgeber, of an id not known.
        const bare = published([row('1.1.3', { bundle: onBase, catalog: { state: 'listed' }, proposedBy: undefined, packageId: undefined })])[0]
        const line = publishedLine(bare, AT)
        expect(line.facts).toBeUndefined()
        expect(line.catalogHref).toBe('/use-cases')
        expect(line.gitlabHref).toBe(`${WEB}/1`)
    })

    it('links to a newer version in „In Arbeit“ in the place of „Neue Version teilen“ (musterbach 1.1.3 / 1.1.4)', () => {
        const newer = row('1.1.4', { bundle: onBase, catalog: { state: 'none' } })
        const [tabbed] = published([newer, listed('1.1.3', 20, { bundle: replacedBy('1.1.4') })])
        const line = publishedLine(tabbed, AT)
        expect(line.next).toEqual({ kind: 'newer', version: '1.1.4', href: inProgressHref(newer) })
        const html = render(createElement(PublishedRow, { line }))
        expect(text(html)).toContain('Version 1.1.4 ist in Arbeit')
        expect(text(html)).not.toContain('Neue Version teilen')
    })

    it('says where that newer version was not accepted, rather than that it is in progress (!31 and !32)', () => {
        const viaAccount = (iid: number, closedAt: string) =>
            proposal('catalog', iid, 'closed', { closedAt, closedByBot: true, closedBy: 'walkable.cities.2021', reason: { kind: 'none' }, source: { kind: 'dataset', id: 'ds-musterbach', instance: HERE } })
        const turnedDown = row('1.1.4', {
            bundle: onBase,
            catalog: { state: 'declined', mrUrl: `${WEB}/32`, declined: { iid: 32, mrUrl: `${WEB}/32`, closedAt: '2026-10-22T09:41:28Z', viaMarketplace: true, reason: { kind: 'none' } } },
            proposals: [viaAccount(32, '2026-10-22T09:41:28Z'), viaAccount(31, '2026-10-22T09:37:23Z'), proposal('bundle', 30, 'merged')],
        })
        const line = publishedLine(published([turnedDown, listed('1.1.3', 20, { bundle: replacedBy('1.1.4') })])[0], AT)
        // Only the entry was turned down: the package of 1.1.4 stays accepted, so the link says what was not (decided 23.10.).
        expect(line.next).toEqual({ kind: 'newer', version: '1.1.4', href: inProgressHref(turnedDown), declined: 'entry' })
        const said = text(render(createElement(PublishedRow, { line })))
        expect(said).toContain('Katalog-Eintrag für 1.1.4 nicht angenommen')
        expect(said).not.toContain('ist in Arbeit')
    })

    it('offers „Neue Version teilen“ where the newer version is another instance’s: it is counted, not listed, so a link would lead nowhere', () => {
        const theirs = row('1.1.4', { bundle: onBase, catalog: { state: 'none' }, source: { kind: 'dataset', id: 'ds-x', instance: 'https://portal.dev.example' } })
        const line = publishedLine(published([theirs, listed('1.1.3', 20, { bundle: replacedBy('1.1.4') })])[0], AT)
        expect(line.next).toEqual({ kind: 'new-version', href: '/export/new?source=dataset:ds-musterbach&from=1.1.3&package=musterbach' })
    })

    it('notes a change to the listed version the catalogue team did not take, for its 30 days (S4)', () => {
        const change = proposal('bundle', 21, 'closed', {
            closedAt: '2026-10-21T10:00:00Z',
            closedBy: 'spaudanjo',
            reason: { kind: 'given', text: 'Bitte als neue Version.' },
            source: { kind: 'dataset', id: 'ds-musterbach', instance: HERE },
        })
        const withChange = (now: number) =>
            shareTabs([listed('1.1.3', 20, { proposals: [change, entry(20), proposal('bundle', 19, 'merged')] })], { instance: HERE, now }).published
        const line = publishedLine(withChange(NOW)[0], AT)
        expect(line.reasons).toEqual([
            {
                text: 'Die Änderung an Version 1.1.3 (Vorschlag !21) hat das Katalog-Team am 21.10. nicht angenommen. Grund (spaudanjo): „Bitte als neue Version.“',
                link: { label: 'Vorschlag ansehen', href: `${WEB}/21`, heard: ' (!21)' },
            },
        ])
        // A note, no block: the version stays in the catalogue, and the way on is as before.
        expect(line.next?.kind).toBe('new-version')
        expect(text(render(createElement(PublishedRow, { line })))).toContain('Die Änderung an Version 1.1.3 (Vorschlag !21)')
        expect(publishedLine(withChange(NOW + 31 * 24 * 60 * 60 * 1000)[0], AT).reasons).toBeUndefined()
    })

    it('names the earlier versions that were in the catalogue, not those that never got there', () => {
        const rows = [
            listed('1.1.3', 20),
            row('1.1.1', { bundle: replacedBy('1.1.3'), catalog: { state: 'none' }, proposals: [entry(12), proposal('bundle', 11, 'merged')] }),
            row('1.1.2', { bundle: replacedBy('1.1.3'), catalog: { state: 'none' } }),
            row('1.0.0', { bundle: replacedBy('1.1.3'), catalog: { state: 'none' }, proposals: [entry(3), proposal('bundle', 2, 'merged')] }),
        ]
        const [tabbed] = published(rows)
        expect(tabbed.listedEarlier).toEqual(['1.0.0', '1.1.1'])
        expect(publishedLine(tabbed, AT).earlier).toBe('Frühere Versionen im Katalog: 1.0.0, 1.1.1')
    })

    it('flags nothing and keeps every way on where this instance has no name to tell shares by (no PORTAL_URL)', () => {
        const [tabbed] = shareTabs([listed('1.0.0', 20, { source: { kind: 'dataset', id: 'ds-musterbach' } })], { now: NOW }).published
        const line = publishedLine(tabbed, { now: NOW })
        expect(line.facts).toBe('Seit 14.10. im Katalog · eingereicht von Ewa · Herausgeber: Open Urban Apps')
        expect(line.gitlabHref).toBe(`${WEB}/20`)
        expect(line.next?.kind).toBe('new-version')
    })

    it('flags an older share whose README names no instance, with only the catalogue link', () => {
        const [tabbed] = published([listed('1.0.0', 20, { source: { kind: 'dataset', id: 'ds-musterbach' } })])
        const line = publishedLine(tabbed, AT)
        expect(line.facts).toBe('Seit 14.10. im Katalog · eingereicht von Ewa · Herausgeber: Open Urban Apps · Instanz unbekannt')
        expect(line.gitlabHref).toBeUndefined()
        expect(line.next).toBeUndefined()
        const html = render(createElement(PublishedRow, { line }))
        expect(text(html)).toBe(
            'Jungbaumbewässerung Musterbach Version 1.0.0 Seit 14.10. im Katalog · eingereicht von Ewa · Herausgeber: Open Urban Apps · Instanz unbekannt Im Katalog ansehen',
        )
    })
})

describe('the list „Veröffentlicht“', () => {
    const list = (props: Partial<Parameters<typeof Published>[0]>) => render(createElement(Published, { rows: [], now: NOW, instance: HERE, ...props }))

    it('shows each entry as a card with its links, and none of the old chips or the entry proposal', () => {
        const html = list({ rows: published([listed('1.1.3', 20)]) })
        expect(text(html)).toBe(
            'Jungbaumbewässerung Musterbach Version 1.1.3 Seit 14.10. im Katalog · eingereicht von Ewa · Herausgeber: Open Urban Apps ' +
                'Im Katalog ansehen In GitLab ansehen Neue Version teilen',
        )
        expect(html).toContain('href="/use-cases/openurbanapps/jungbaumbewaesserung-musterbach"')
        expect(html).toContain('href="/export/new?source=dataset:ds-musterbach&amp;from=1.1.3&amp;package=musterbach"')
        expect(text(html)).not.toMatch(/Paket: |Katalog: |Katalog-Eintrag vorschlagen|Stand: |v1\.1\.3/)
        // „Neue Version teilen“ is secondary: the page's one primary is „Neues Paket teilen“.
        expect(html).not.toContain('bg-primary')
        expect(html.match(/rounded-lg border bg-card p-5/g)).toHaveLength(1)
        // From tablet width on, the links take at most half the card and wrap there, so the name keeps its room; with no
        // line between name and links, they span no second, empty row.
        expect(html).toContain('sm:grid-cols-[minmax(0,1fr)_fit-content(50%)]')
        expect(html).not.toContain('sm:row-span-2')
    })

    it('says when nothing is published, counts other instances’ entries, and says when GitLab could not be read', () => {
        expect(text(list({}))).toContain('Von dieser Instanz steht noch nichts im Katalog.')
        expect(text(list({ rows: published([listed('1.1.3', 20)]), elsewhere: 1 }))).toContain('1 weiterer Eintrag stammt von einer anderen Instanz.')
        expect(text(list({ error: 'GitLab-Fehler (500)' }))).toBe('Was im Katalog steht, ließ sich gerade nicht abfragen (GitLab-Fehler (500)).')
    })
})
