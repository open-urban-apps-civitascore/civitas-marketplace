import { describe, expect, it } from 'vitest'

import type { ShareProposal, SharedPackageRow } from '@/lib/export/share-listing'
import { instanceMatch, rowOutcome, shareTabs, TAB_OF, type ShareOutcome, type ShareTab } from '@/lib/export/share-tabs'

const HERE = 'https://portal.hier.example'
const THERE = 'https://portal.dev.example'
const WEB = 'https://gitlab.example/group/catalog/-/merge_requests'

const proposal = (kind: ShareProposal['kind'], iid: number, state: string, extra: Partial<ShareProposal> = {}): ShareProposal => ({
    kind,
    iid,
    url: `${WEB}/${iid}`,
    state,
    ...extra,
})

/** One version as the listing reads it; from this instance by Ewa unless said otherwise. */
const row = (slug: string, version: string, facts: Partial<SharedPackageRow> = {}): SharedPackageRow => ({
    key: `t#export/${slug}-${version}`,
    targetKey: 't',
    targetLabel: 'Ablage',
    slug,
    version,
    displayName: slug,
    bundleMr: { url: `${WEB}/1`, state: 'merged' },
    source: { kind: 'dataset', id: `ds-${slug}`, instance: HERE },
    proposedBy: 'Ewa',
    proposals: [proposal('bundle', 1, facts.bundleMr?.state ?? 'merged')],
    ...facts,
})

const verified = { state: 'verified' as const }
const onBase = (extra: Record<string, unknown> = {}) => ({ state: 'on-base' as const, packageId: 'urn:x:usecase:a', verification: verified, ...extra })
const replacedBy = (version: string) => ({ state: 'none' as const, reason: 'other-version' as const, onBase: { id: 'urn:x:usecase:a', version } })
const open = { bundleMr: { url: `${WEB}/1`, state: 'opened' } }

/** Every outcome, reached by a row as the listing would read it, and the list it belongs in. */
const OUTCOMES: [ShareOutcome, SharedPackageRow, ShareTab | undefined][] = [
    ['unreadable', row('a', '1.0.0', { problem: 'GitLab-Fehler (500)' }), 'in-progress'],
    ['in-review', row('a', '1.0.0', { ...open, proposals: [proposal('bundle', 1, 'opened')] }), 'in-progress'],
    ['change-in-review', row('a', '1.0.0', { ...open, proposals: [proposal('bundle', 2, 'opened'), proposal('bundle', 1, 'merged')] }), 'in-progress'],
    ['removal-pending', row('a', '1.0.0', { bundle: onBase({ removal: { state: 'opened', mrUrl: `${WEB}/9` } }), catalog: { state: 'none' } }), 'in-progress'],
    ['accepted', row('a', '1.0.0', { bundle: onBase(), catalog: { state: 'none' } }), 'in-progress'],
    ['needs-look', row('a', '1.0.0', { bundle: onBase({ verification: { state: 'changed-after-merge' } }), catalog: { state: 'none' } }), 'in-progress'],
    ['broken', row('a', '1.0.0', { bundle: { state: 'none', reason: 'bad-manifest' } }), 'in-progress'],
    ['broken', row('a', '1.0.0', { bundle: { state: 'none', reason: 'no-base-branch' } }), 'in-progress'],
    ['no-catalogue', row('a', '1.0.0', { bundle: onBase(), catalog: { state: 'unconfigured' } }), 'in-progress'],
    ['entry-in-review', row('a', '1.0.0', { bundle: onBase(), catalog: { state: 'mr-open', mrUrl: `${WEB}/8` } }), 'in-progress'],
    ['brings-back', row('a', '1.0.0', { bundle: onBase(), catalog: { state: 'mr-open', mrUrl: `${WEB}/8`, takenOut: { version: '1.0.0' }, bringsBack: true } }), 'in-progress'],
    ['listed', row('a', '1.0.0', { bundle: onBase(), catalog: { state: 'listed' } }), 'published'],
    // Listed pins a commit: what happened to the folder since does not matter for it.
    ['listed', row('a', '1.0.0', { bundle: onBase({ verification: { state: 'changed-after-merge' } }), catalog: { state: 'listed' } }), 'published'],
    ['replaced', row('a', '1.0.0', { bundle: replacedBy('1.1.0'), catalog: { state: 'none' } }), undefined],
    ['taken-out', row('a', '1.0.0', { bundle: onBase(), catalog: { state: 'withdrawn', takenOut: { version: '1.0.0' } } }), 'ended'],
    ['removed', row('a', '1.0.0', { bundle: { state: 'none', reason: 'no-package', removal: { state: 'merged', mrUrl: `${WEB}/9` } } }), 'ended'],
    ['gone', row('a', '1.0.0', { bundle: { state: 'none', reason: 'no-package' } }), 'ended'],
    ['gone', row('a', '1.1.0', { bundle: replacedBy('1.0.0') }), 'ended'],
    ['withdrawn', row('a', '1.0.0', { bundleMr: { url: `${WEB}/1`, state: 'closed' }, withdrawn: true }), 'ended'],
    ['not-accepted', row('a', '1.0.0', { bundleMr: { url: `${WEB}/1`, state: 'closed' } }), 'ended'],
]

describe('rowOutcome and TAB_OF', () => {
    it.each(OUTCOMES)('%s', (outcome, shared, tab) => {
        expect(rowOutcome(shared)).toBe(outcome)
        expect(TAB_OF[outcome]).toBe(tab)
    })

    it('reaches every outcome there is', () => {
        expect(new Set(OUTCOMES.map(([outcome]) => outcome))).toEqual(new Set(Object.keys(TAB_OF)))
    })

    it('treats a state GitLab names otherwise, and a merge not read, as still open', () => {
        expect(rowOutcome(row('a', '1.0.0', { bundleMr: { url: `${WEB}/1`, state: 'locked' } }))).toBe('in-review')
        expect(rowOutcome(row('a', '1.0.0'))).toBe('unreadable')
    })
})

const keys = (rows: { row: SharedPackageRow }[]) => rows.map((tabbed) => `${tabbed.row.slug} ${tabbed.row.version}`)

describe('shareTabs', () => {
    it('lists a version replaced by a newer listed one nowhere, and as an earlier version of that one', () => {
        const tabs = shareTabs(
            [
                row('baeume', '1.1.0', { bundle: onBase(), catalog: { state: 'listed' } }),
                row('baeume', '1.0.0', { bundle: replacedBy('1.1.0'), catalog: { state: 'none' } }),
            ],
            { instance: HERE },
        )
        expect(keys(tabs.published)).toEqual(['baeume 1.1.0'])
        expect(tabs.published[0].earlier).toEqual(['1.0.0'])
        expect(tabs.inProgress).toEqual([])
        expect(tabs.ended).toEqual([])
        expect(tabs.counts.published).toBe(1)
    })

    it('keeps a listed version in „Veröffentlicht“ while its newer one waits for the entry (musterbach 1.1.3 / 1.1.4)', () => {
        const tabs = shareTabs(
            [
                row('musterbach', '1.1.4', { bundle: onBase(), catalog: { state: 'none' } }),
                row('musterbach', '1.1.3', { bundle: replacedBy('1.1.4'), catalog: { state: 'listed' } }),
                row('musterbach', '1.1.2', { bundle: replacedBy('1.1.4'), catalog: { state: 'none' } }),
            ],
            { instance: HERE, person: 'Ewa' },
        )
        expect(keys(tabs.published)).toEqual(['musterbach 1.1.3'])
        expect(tabs.published[0].newer).toEqual({ key: 't#export/musterbach-1.1.4', version: '1.1.4' })
        expect(tabs.published[0].earlier).toEqual(['1.1.2'])
        expect(keys(tabs.inProgress)).toEqual(['musterbach 1.1.4'])
        expect(tabs.inProgress[0]).toMatchObject({ outcome: 'accepted', mine: true, earlier: ['1.1.2'] })
        expect(tabs.counts).toEqual({ inProgress: 1, mine: 1, published: 1 })
        expect([...tabs.busy.keys()]).toEqual(['ds-musterbach'])
    })

    it('links a listed version only to a newer one „In Arbeit“ shows, not to another instance’s', () => {
        const listed = row('musterbach', '1.1.3', { bundle: replacedBy('1.1.4'), catalog: { state: 'listed' } })
        const newer = row('musterbach', '1.1.4', { bundle: onBase(), catalog: { state: 'none' }, source: { kind: 'dataset', id: 'ds-x', instance: THERE } })
        const tabs = shareTabs([newer, listed], { instance: HERE })
        expect(keys(tabs.published)).toEqual(['musterbach 1.1.3'])
        expect(tabs.published[0].newer).toBeUndefined()
        expect(tabs.inProgress).toEqual([])
        expect(tabs.elsewhere['in-progress']).toBe(1)
    })

    it('makes an accepted package waiting for its entry the move of the person who proposed it, not of a colleague', () => {
        const accepted = [row('pegel', '1.0.0', { bundle: onBase(), catalog: { state: 'none' } })]
        expect(shareTabs(accepted, { instance: HERE, person: 'ewa ' }).counts.mine).toBe(1)
        expect(shareTabs(accepted, { instance: HERE, person: 'Kim' }).inProgress[0].mine).toBe(false)
        expect(shareTabs(accepted, { instance: HERE, person: 'Kim' }).counts).toEqual({ inProgress: 1, mine: 0, published: 0 })
        // A share that names nobody counts as nobody else's.
        expect(shareTabs([{ ...accepted[0], proposedBy: undefined }], { instance: HERE, person: 'Kim' }).counts.mine).toBe(1)
    })

    it('counts what waits for the catalogue team, but never as the person’s move', () => {
        const tabs = shareTabs(
            [
                row('a', '1.0.0', { bundle: onBase(), catalog: { state: 'mr-open', mrUrl: `${WEB}/8` } }),
                row('b', '1.0.0', { ...open, proposals: [proposal('bundle', 1, 'opened')] }),
                row('c', '1.0.0', { bundle: onBase({ removal: { state: 'opened', mrUrl: `${WEB}/9` } }), catalog: { state: 'none' } }),
            ],
            { instance: HERE, person: 'Ewa' },
        )
        expect(tabs.inProgress.map((tabbed) => tabbed.outcome)).toEqual(['entry-in-review', 'in-review', 'removal-pending'])
        expect(tabs.counts).toEqual({ inProgress: 3, mine: 0, published: 0 })
        expect([...tabs.busy.keys()]).toEqual(['ds-a', 'ds-b', 'ds-c'])
    })

    it('adds started shares to „In Arbeit“ and to the person’s moves', () => {
        const tabs = shareTabs([row('a', '1.0.0', { bundle: onBase(), catalog: { state: 'mr-open' } })], { instance: HERE, drafts: 2 })
        expect(tabs.counts).toEqual({ inProgress: 3, mine: 2, published: 0 })
    })

    it('lists a row it could not read in „In Arbeit“, as nobody’s move, and makes its dataset busy for nobody', () => {
        const tabs = shareTabs([row('a', '1.0.0', { problem: 'GitLab-Fehler (500)', bundle: undefined })], { instance: HERE, person: 'Ewa' })
        expect(tabs.inProgress[0]).toMatchObject({ outcome: 'unreadable', mine: false })
        expect(tabs.busy.size).toBe(0)
    })

    it('enters a version the catalogue team took out once, with their reason, whichever rows report it', () => {
        const tabs = shareTabs(
            [
                row('baeume', '1.2.0', { bundle: onBase(), catalog: { state: 'none', takenOut: { version: '1.1.0', reason: 'Datenquelle abgeschaltet' } } }),
                row('baeume', '1.1.0', { bundle: replacedBy('1.2.0'), catalog: { state: 'withdrawn', takenOut: { version: '1.1.0' } } }),
                row('baeume', '1.0.0', { bundle: replacedBy('1.2.0'), catalog: { state: 'none' } }),
            ],
            { instance: HERE },
        )
        expect(tabs.ended).toEqual([
            {
                key: 't#baeume@1.1.0#taken-out',
                ending: 'taken-out',
                what: 'version',
                row: expect.objectContaining({ version: '1.1.0' }),
                version: '1.1.0',
                reason: 'Datenquelle abgeschaltet',
                origin: 'this',
            },
        ])
        // The newer version may still be shared: it waits for its entry.
        expect(keys(tabs.inProgress)).toEqual(['baeume 1.2.0'])
    })

    it('enters a whole entry withdrawn by the catalogue team once, at the version the index names', () => {
        const withdrawn = { state: 'withdrawn' as const, takenOut: { version: '1.0.0', reason: 'Doppelt' } }
        const tabs = shareTabs(
            [row('baeume', '1.1.0', { bundle: onBase(), catalog: withdrawn }), row('baeume', '1.0.0', { bundle: replacedBy('1.1.0'), catalog: withdrawn })],
            { instance: HERE },
        )
        expect(tabs.ended.map((entry) => [entry.ending, entry.version, entry.reason])).toEqual([['taken-out', '1.0.0', 'Doppelt']])
        expect(tabs.inProgress).toEqual([])
        expect(tabs.published).toEqual([])
    })

    it('enters each ended proposal: withdrawn with its note, closed by hand through the account, closed by a reviewer', () => {
        const tabs = shareTabs(
            [
                row('pegel', '1.0.0', {
                    bundleMr: { url: `${WEB}/14`, state: 'closed' },
                    withdrawn: true,
                    proposals: [proposal('bundle', 14, 'closed', { closedAt: '2026-10-17T10:00:00Z', closedByBot: true, withdrawnBy: 'Ewa' })],
                }),
                row('wind', '1.0.0', {
                    bundleMr: { url: `${WEB}/13`, state: 'closed' },
                    proposals: [proposal('bundle', 13, 'closed', { closedAt: '2026-10-16T10:00:00Z', closedByBot: true })],
                }),
                row('regen', '1.0.0', {
                    bundleMr: { url: `${WEB}/12`, state: 'closed' },
                    proposals: [proposal('bundle', 12, 'closed', { closedAt: '2026-10-15T10:00:00Z', closedBy: 'kurator' })],
                }),
            ],
            { instance: HERE },
        )
        expect(tabs.ended.map((entry) => [entry.row.slug, entry.ending, entry.what, entry.at])).toEqual([
            ['pegel', 'withdrawn', 'bundle', '2026-10-17T10:00:00Z'],
            ['wind', 'not-accepted', 'bundle', '2026-10-16T10:00:00Z'],
            ['regen', 'not-accepted', 'bundle', '2026-10-15T10:00:00Z'],
        ])
        expect(tabs.ended[0].proposal?.withdrawnBy).toBe('Ewa')
        expect(tabs.ended[1].proposal?.closedByBot).toBe(true)
        expect(tabs.ended[2].proposal?.closedBy).toBe('kurator')
        expect(tabs.inProgress).toEqual([])
    })

    it('enters a removal: accepted through a proposal with its date, or done by hand without one', () => {
        const tabs = shareTabs(
            [
                row('a', '1.0.0', {
                    bundle: { state: 'none', reason: 'no-package', removal: { state: 'merged', mrUrl: `${WEB}/9` } },
                    proposals: [proposal('removal', 9, 'merged', { mergedAt: '2026-10-12T10:00:00Z', mergedBy: 'kurator', proposedBy: 'Ewa' }), proposal('bundle', 1, 'merged')],
                }),
                row('b', '1.0.0', { bundle: { state: 'none', reason: 'no-package' } }),
            ],
            { instance: HERE },
        )
        expect(tabs.ended.map((entry) => [entry.row.slug, entry.ending, entry.what, entry.at, entry.byHand])).toEqual([
            ['a', 'removed', 'removal', '2026-10-12T10:00:00Z', undefined],
            ['b', 'removed', 'version', undefined, true],
        ])
    })

    it('enters a withdrawn catalogue entry, and keeps the accepted package in „In Arbeit“', () => {
        const tabs = shareTabs(
            [
                row('a', '1.0.0', {
                    bundle: onBase(),
                    catalog: { state: 'none' },
                    proposals: [proposal('catalog', 8, 'closed', { closedByBot: true, withdrawnBy: 'Ewa', closedAt: '2026-10-17T10:00:00Z' }), proposal('bundle', 1, 'merged')],
                }),
            ],
            { instance: HERE },
        )
        expect(keys(tabs.inProgress)).toEqual(['a 1.0.0'])
        expect(tabs.ended.map((entry) => [entry.what, entry.ending])).toEqual([['catalog', 'withdrawn']])
    })

    it('handles two proposals on one branch (bodenfeuchte): an open change on the accepted package, or a withdrawn one', () => {
        const change = shareTabs(
            [row('bodenfeuchte', '1.0.0', { ...open, proposals: [proposal('bundle', 21, 'opened'), proposal('bundle', 20, 'merged')] })],
            { instance: HERE, person: 'Ewa' },
        )
        expect(change.inProgress.map((tabbed) => [tabbed.outcome, tabbed.mine])).toEqual([['change-in-review', false]])
        expect(change.ended).toEqual([])

        const withdrawn = shareTabs(
            [
                row('bodenfeuchte', '1.0.0', {
                    bundle: onBase(),
                    catalog: { state: 'none' },
                    proposals: [proposal('bundle', 21, 'closed', { closedByBot: true, withdrawnBy: 'Ewa', closedAt: '2026-10-17T10:00:00Z' }), proposal('bundle', 20, 'merged')],
                }),
            ],
            { instance: HERE },
        )
        expect(withdrawn.inProgress.map((tabbed) => tabbed.outcome)).toEqual(['accepted'])
        expect(withdrawn.ended.map((entry) => [entry.proposal?.iid, entry.ending])).toEqual([[21, 'withdrawn']])
    })

    it('counts another instance’s shares in every list instead of listing them, and makes none of its datasets busy', () => {
        const there = { kind: 'dataset' as const, id: 'ds-x', instance: THERE }
        const tabs = shareTabs(
            [
                row('a', '1.0.0', { source: there, bundle: onBase(), catalog: { state: 'none' } }),
                row('b', '1.0.0', { source: there, bundle: onBase(), catalog: { state: 'listed' } }),
                row('c', '1.0.0', { source: there, bundleMr: { url: `${WEB}/1`, state: 'closed' }, proposals: [proposal('bundle', 1, 'closed')] }),
            ],
            { instance: HERE, person: 'Ewa' },
        )
        expect(tabs.inProgress).toEqual([])
        expect(tabs.published).toEqual([])
        expect(tabs.ended).toEqual([])
        expect(tabs.elsewhere).toEqual({ 'in-progress': 1, published: 1, ended: 1 })
        expect(tabs.busy.size).toBe(0)
        expect(tabs.counts).toEqual({ inProgress: 0, mine: 0, published: 0 })
    })

    it('shows a share of an unknown instance with that flag, and counts it as here', () => {
        const tabs = shareTabs(
            [
                row('a', '1.0.0', { source: { kind: 'dataset', id: 'ds-a' }, bundle: onBase(), catalog: { state: 'listed' } }),
                row('b', '1.0.0', { source: undefined, bundle: onBase(), catalog: { state: 'mr-open' } }),
            ],
            { instance: HERE },
        )
        expect(tabs.published.map((tabbed) => tabbed.origin)).toEqual(['unknown'])
        expect(tabs.inProgress.map((tabbed) => tabbed.origin)).toEqual(['unknown'])
        // Without a dataset id, nothing to grey out.
        expect(tabs.busy.size).toBe(0)
        expect(tabs.counts).toEqual({ inProgress: 1, mine: 0, published: 1 })
    })

    it('takes a proposal’s own instance over its row’s, as two proposals on one branch may come from two instances', () => {
        const tabs = shareTabs(
            [
                row('a', '1.0.0', {
                    bundle: onBase(),
                    catalog: { state: 'none' },
                    proposals: [
                        proposal('catalog', 8, 'closed', { closedBy: 'kurator', source: { kind: 'dataset', id: 'ds-a', instance: THERE } }),
                        proposal('catalog', 7, 'closed', { closedBy: 'kurator' }),
                        proposal('bundle', 1, 'merged'),
                    ],
                }),
            ],
            { instance: HERE },
        )
        expect(tabs.ended.map((entry) => entry.proposal?.iid)).toEqual([7])
        expect(tabs.elsewhere.ended).toBe(1)
    })

    it('puts the newest ending first and what has no date last', () => {
        const closed = (slug: string, closedAt?: string) =>
            row(slug, '1.0.0', { bundleMr: { url: `${WEB}/1`, state: 'closed' }, proposals: [proposal('bundle', 1, 'closed', closedAt ? { closedAt } : {})] })
        const tabs = shareTabs([closed('alt', '2026-10-01T00:00:00Z'), closed('ohne'), closed('neu', '2026-10-17T00:00:00Z')], { instance: HERE })
        expect(tabs.ended.map((entry) => entry.row.slug)).toEqual(['neu', 'alt', 'ohne'])
    })

    it('reads the endings of a row built without its proposals from its own fields', () => {
        const tabs = shareTabs(
            [
                { ...row('a', '1.0.0', { bundleMr: { url: `${WEB}/4`, state: 'closed' }, withdrawn: true }), proposals: undefined },
                { ...row('b', '1.0.0', { bundle: { state: 'none', reason: 'no-package', removal: { state: 'merged', mrUrl: `${WEB}/9` } } }), proposals: undefined },
            ],
            { instance: HERE },
        )
        expect(tabs.ended.map((entry) => [entry.row.slug, entry.ending, entry.what, entry.proposal?.iid])).toEqual([
            ['a', 'withdrawn', 'bundle', 4],
            ['b', 'removed', 'removal', 9],
        ])
    })
})

describe('instanceMatch', () => {
    it('compares addresses without trailing slashes and case', () => {
        expect(instanceMatch({ instance: 'https://Portal.Hier.example/' }, HERE)).toBe('this')
        expect(instanceMatch({ instance: THERE }, HERE)).toBe('other')
    })

    it('tells nothing when either side names no instance', () => {
        expect(instanceMatch({}, HERE)).toBe('unknown')
        expect(instanceMatch(undefined, HERE)).toBe('unknown')
        expect(instanceMatch({ instance: THERE }, undefined)).toBe('unknown')
    })
})
