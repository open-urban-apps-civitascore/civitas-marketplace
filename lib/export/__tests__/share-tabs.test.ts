import { describe, expect, it } from 'vitest'

import type { Decline } from '@/lib/export/declines'
import type { ShareProposal, SharedPackageRow } from '@/lib/export/share-listing'
import { declineIsCurrent, instanceMatch, rowOutcome, shareTabs, TAB_OF, type ShareOutcome, type ShareTab } from '@/lib/export/share-tabs'

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
/** A "no" as the listing's reading carries it. */
const decline = (iid: number, extra: Partial<Decline> = {}): Decline => ({ iid, mrUrl: `${WEB}/${iid}`, reason: { kind: 'none' }, ...extra })
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
    // A "no" is listed in „In Arbeit“ while it is current (see the block below), else only as an ending.
    ['declined', row('a', '1.0.0', { bundleMr: { url: `${WEB}/1`, state: 'closed' } }), 'in-progress'],
    ['entry-declined', row('a', '1.0.0', { bundle: onBase(), catalog: { state: 'declined', mrUrl: `${WEB}/32`, declined: decline(32) } }), 'in-progress'],
    ['removal-declined', row('a', '1.0.0', { bundle: onBase({ removal: { state: 'closed', mrUrl: `${WEB}/9`, declined: decline(9) } }), catalog: { state: 'none' } }), 'in-progress'],
    ['entry-revoked', row('a', '1.1.0', { bundle: onBase(), catalog: { state: 'withdrawn', takenOut: { version: '1.0.0' } } }), 'in-progress'],
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

    it('enters a whole entry withdrawn by the catalogue team once, at the version the index names, and keeps the newer accepted one in „In Arbeit“ (S9)', () => {
        const withdrawn = { state: 'withdrawn' as const, takenOut: { version: '1.0.0', reason: 'Doppelt' } }
        const tabs = shareTabs(
            [row('baeume', '1.1.0', { bundle: onBase(), catalog: withdrawn }), row('baeume', '1.0.0', { bundle: replacedBy('1.1.0'), catalog: withdrawn })],
            { instance: HERE, person: 'Ewa' },
        )
        expect(tabs.ended.map((entry) => [entry.ending, entry.version, entry.reason])).toEqual([['taken-out', '1.0.0', 'Doppelt']])
        // Until rc.6 it was in no list at all. Nobody here can move it on, so it is nobody's move, and its dataset is free for a new version.
        expect(tabs.inProgress.map((tabbed) => [tabbed.row.version, tabbed.outcome, tabbed.mine])).toEqual([['1.1.0', 'entry-revoked', false]])
        expect(tabs.inProgress[0].progress.states).toEqual({ propose: 'done', review: 'done', catalog: 'blocked', listing: 'later' })
        expect(tabs.busy.size).toBe(0)
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

describe('a "no" from the catalogue team (2026-10-22)', () => {
    const NOW = Date.parse('2026-10-22T12:00:00Z')
    const DAY = 24 * 60 * 60 * 1000
    const sourced = { source: { kind: 'dataset' as const, id: 'ds-x', instance: HERE } }
    /** A proposal closed by the catalogue team, from this instance, the day before NOW. */
    const turnedDown = (kind: ShareProposal['kind'], iid: number, extra: Partial<ShareProposal> = {}) =>
        proposal(kind, iid, 'closed', { closedAt: '2026-10-21T10:00:00Z', closedBy: 'spaudanjo', reason: { kind: 'given', text: 'Die Datenquelle ist nicht öffentlich.' }, ...sourced, ...extra })
    const packageNo = (extra: Partial<ShareProposal> = {}, version = '1.0.0') =>
        row('pegel', version, { bundleMr: { url: `${WEB}/14`, state: 'closed' }, proposals: [turnedDown('bundle', 14, extra)] })

    it('keeps a turned-down package in „In Arbeit“ as the person’s move, with the team’s words, and as an ending in „Beendet“ (S1)', () => {
        const tabs = shareTabs([packageNo()], { instance: HERE, person: 'Ewa', now: NOW })
        expect(tabs.inProgress.map((tabbed) => [tabbed.outcome, tabbed.mine])).toEqual([['declined', true]])
        expect(tabs.inProgress[0].declined).toEqual({
            decline: { iid: 14, mrUrl: `${WEB}/14`, closedAt: '2026-10-21T10:00:00Z', closedBy: 'spaudanjo', reason: { kind: 'given', text: 'Die Datenquelle ist nicht öffentlich.' } },
            current: true,
        })
        // The stage turned down carries the problem mark; the person's move is to read it and share a higher version.
        expect(tabs.inProgress[0].progress).toMatchObject({ states: { propose: 'done', review: 'declined', catalog: 'later', listing: 'later' }, turn: 'you', finished: true })
        expect(tabs.counts).toEqual({ inProgress: 1, mine: 1, published: 0 })
        expect(tabs.ended.map((entry) => [entry.what, entry.ending, entry.proposal?.iid])).toEqual([['bundle', 'not-accepted', 14]])
        // Its way on is a new version, which „Auswählen“ starts: the dataset is not busy.
        expect(tabs.busy.size).toBe(0)
    })

    it('is the person’s move for 30 days after the close, then only an ending', () => {
        const at = (days: number) => shareTabs([packageNo()], { instance: HERE, person: 'Ewa', now: Date.parse('2026-10-21T10:00:00Z') + days * DAY })
        expect(at(30).inProgress).toHaveLength(1)
        expect(at(30.01).inProgress).toEqual([])
        expect(at(30.01).counts).toEqual({ inProgress: 0, mine: 0, published: 0 })
        expect(at(30.01).ended.map((entry) => entry.ending)).toEqual(['not-accepted'])
    })

    it('leaves a close older than rc.6 without a source line to „Beendet“, closed a day ago or not (U1, !3 and !5)', () => {
        const old = (slug: string, iid: number) =>
            row(slug, '1.0.0', {
                bundleMr: { url: `${WEB}/${iid}`, state: 'closed' },
                source: undefined,
                proposals: [proposal('bundle', iid, 'closed', { closedAt: '2026-10-21T10:00:00Z', closedByBot: true, reason: { kind: 'none' } })],
            })
        const tabs = shareTabs([old('kiez-baumkataster', 3), old('export-test-1', 5)], { instance: HERE, person: 'Ewa', now: NOW })
        expect(tabs.inProgress).toEqual([])
        expect(tabs.ended.map((entry) => [entry.row.slug, entry.ending, entry.origin])).toEqual([
            ['kiez-baumkataster', 'not-accepted', 'unknown'],
            ['export-test-1', 'not-accepted', 'unknown'],
        ])
    })

    it('is nobody’s move here when the turned-down proposal names another instance, or none can be told', () => {
        expect(shareTabs([packageNo({ source: { kind: 'dataset', id: 'ds-x', instance: THERE } })], { instance: HERE, now: NOW }).inProgress).toEqual([])
        expect(shareTabs([packageNo()], { now: NOW }).inProgress).toEqual([])
        expect(declineIsCurrent({ kind: 'bundle', closedAt: undefined, source: sourced.source }, '1.0.0', [], HERE, NOW)).toBe(false)
    })

    it('leaves „In Arbeit“ once a newer version of the package has a proposal, and is told among that one’s earlier versions (S14)', () => {
        const newer = row('pegel', '1.0.1', { ...open, proposals: [proposal('bundle', 15, 'opened')] })
        const tabs = shareTabs([newer, packageNo()], { instance: HERE, person: 'Ewa', now: NOW })
        expect(tabs.inProgress.map((tabbed) => `${tabbed.row.version} ${tabbed.outcome}`)).toEqual(['1.0.1 in-review'])
        expect(tabs.inProgress[0]).toMatchObject({ earlier: [], declinedEarlier: ['1.0.0'] })
        expect(tabs.ended.map((entry) => entry.version)).toEqual(['1.0.0'])
        // An entry turned down counts too (Ewa's 1.1.4), a replaced version stays plain, and a higher "no" is no earlier version.
        const entryNo = row('pegel', '1.0.2', { bundle: onBase(), catalog: { state: 'declined', mrUrl: `${WEB}/32`, declined: decline(32) } })
        const newest = row('pegel', '1.0.3', { ...open, proposals: [proposal('bundle', 16, 'opened')] })
        const all = shareTabs([newest, entryNo, row('pegel', '0.9.0', { bundle: replacedBy('1.0.2') }), packageNo(), packageNo({}, '1.1.0')], { instance: HERE, now: NOW })
        expect(all.inProgress.find((tabbed) => tabbed.row.version === '1.0.3')).toMatchObject({ earlier: ['0.9.0'], declinedEarlier: ['1.0.0', '1.0.2'] })
    })

    it('says „nicht angenommen“ of no earlier version that may be a withdrawal whose comments could not be read just now (S14, U4)', () => {
        const newer = row('pegel', '1.0.1', { ...open, proposals: [proposal('bundle', 15, 'opened')] })
        // Closed through the marketplace's account without the mark, before rc.7: a withdrawal left its note as a comment.
        const unsure = packageNo({ closedByBot: true, closedBy: 'walkable.cities.2021', reason: { kind: 'unreadable' } })
        expect(shareTabs([newer, unsure], { instance: HERE, person: 'Ewa', now: NOW }).inProgress[0]).toMatchObject({ declinedEarlier: [] })
        // Once its comments are read and hold no withdrawal, it is a "no" as any other.
        const read = packageNo({ closedByBot: true, closedBy: 'walkable.cities.2021', reason: { kind: 'none' } })
        expect(shareTabs([newer, read], { instance: HERE, person: 'Ewa', now: NOW }).inProgress[0]).toMatchObject({ declinedEarlier: ['1.0.0'] })
    })

    it('waits again once the team reopens it: no "no" and no ending (S11)', () => {
        const reopened = row('pegel', '1.0.0', { bundleMr: { url: `${WEB}/14`, state: 'opened' }, proposals: [proposal('bundle', 14, 'opened', sourced)] })
        const tabs = shareTabs([reopened], { instance: HERE, person: 'Ewa', now: NOW })
        expect(tabs.inProgress.map((tabbed) => [tabbed.outcome, tabbed.mine, tabbed.declined])).toEqual([['in-review', false, undefined]])
        expect(tabs.ended).toEqual([])
    })

    it('reads the entry closed twice through the marketplace’s account as turned down, from the newer close (S5, S10: !31 and !32)', () => {
        const viaAccount = (iid: number, closedAt: string) =>
            proposal('catalog', iid, 'closed', { createdAt: closedAt.replace(/:..Z$/, ':00Z'), closedAt, closedByBot: true, closedBy: 'walkable.cities.2021', comments: 0, reason: { kind: 'none' }, ...sourced })
        const proposals = [viaAccount(32, '2026-10-22T09:41:28Z'), viaAccount(31, '2026-10-22T09:37:23Z'), proposal('bundle', 30, 'merged', sourced)]
        const musterbach = row('jungbaumbewaesserung-musterbach', '1.1.4', {
            bundle: onBase(),
            catalog: { state: 'declined', mrUrl: `${WEB}/32`, declined: decline(32, { closedAt: '2026-10-22T09:41:28Z', viaMarketplace: true }) },
            proposals,
        })
        const tabs = shareTabs([musterbach], { instance: HERE, person: 'Ewa', now: NOW })
        expect(tabs.inProgress.map((tabbed) => [tabbed.outcome, tabbed.mine])).toEqual([['entry-declined', true]])
        expect(tabs.inProgress[0].declined?.decline).toMatchObject({ iid: 32, viaMarketplace: true, closedBy: 'walkable.cities.2021', reason: { kind: 'none' } })
        expect(tabs.inProgress[0].progress.states).toEqual({ propose: 'done', review: 'done', catalog: 'done', listing: 'declined' })
        // Each close is an ending of its own, through the marketplace's account.
        expect(tabs.ended.map((entry) => [entry.what, entry.ending, entry.proposal?.iid, entry.proposal?.closedByBot])).toEqual([
            ['catalog', 'not-accepted', 32, true],
            ['catalog', 'not-accepted', 31, true],
        ])
        expect(tabs.busy.size).toBe(0)
    })

    it('keeps a package whose removal was turned down in „In Arbeit“: the person’s move for 30 days, then nobody’s (S8)', () => {
        const removalNo = (now: number) =>
            shareTabs(
                [
                    row('regen', '1.0.0', {
                        bundle: onBase({ removal: { state: 'closed', mrUrl: `${WEB}/9`, declined: decline(9, { closedAt: '2026-10-21T10:00:00Z' }) } }),
                        catalog: { state: 'none' },
                        proposals: [turnedDown('removal', 9), proposal('bundle', 1, 'merged', sourced)],
                    }),
                ],
                { instance: HERE, person: 'Ewa', now },
            )
        const during = removalNo(NOW)
        expect(during.inProgress.map((tabbed) => [tabbed.outcome, tabbed.mine, tabbed.declined?.current])).toEqual([['removal-declined', true, true]])
        expect(during.ended.map((entry) => [entry.what, entry.ending])).toEqual([['removal', 'not-accepted']])
        // The package stays accepted, so its dataset stays busy, as for any accepted version.
        expect([...during.busy.keys()]).toEqual(['ds-regen'])
        const after = removalNo(NOW + 31 * DAY)
        expect(after.inProgress.map((tabbed) => [tabbed.outcome, tabbed.mine, tabbed.declined?.current])).toEqual([['removal-declined', false, false]])
        expect(after.counts).toEqual({ inProgress: 1, mine: 0, published: 0 })
    })

    it('tells the later of two "no"s when both the entry and the removal were turned down', () => {
        const both = (entryAt: string, removalAt: string) =>
            rowOutcome(
                row('regen', '1.0.0', {
                    bundle: onBase({ removal: { state: 'closed', mrUrl: `${WEB}/9`, declined: decline(9, { closedAt: removalAt }) } }),
                    catalog: { state: 'declined', mrUrl: `${WEB}/8`, declined: decline(8, { closedAt: entryAt }) },
                }),
            )
        expect(both('2026-10-20T10:00:00Z', '2026-10-21T10:00:00Z')).toBe('removal-declined')
        expect(both('2026-10-21T10:00:00Z', '2026-10-20T10:00:00Z')).toBe('entry-declined')
    })

    it('notes a turned-down change on the accepted version, without a block, while it is news (S4: bodenfeuchte !19 and !21)', () => {
        const bodenfeuchte = (now: number) =>
            shareTabs(
                [
                    row('bodenfeuchte', '1.0.0', {
                        bundle: onBase(),
                        catalog: { state: 'none' },
                        proposals: [turnedDown('bundle', 21), proposal('bundle', 19, 'merged', sourced)],
                    }),
                ],
                { instance: HERE, person: 'Ewa', now },
            )
        const tabs = bodenfeuchte(NOW)
        // A merge beats a later closed duplicate: the version stays accepted, the entry can still be proposed.
        expect(tabs.inProgress.map((tabbed) => [tabbed.outcome, tabbed.mine, tabbed.declined])).toEqual([['accepted', true, undefined]])
        expect(tabs.inProgress[0].declinedChange).toMatchObject({ iid: 21, closedBy: 'spaudanjo', reason: { kind: 'given' } })
        expect(tabs.ended.map((entry) => [entry.proposal?.iid, entry.ending])).toEqual([[21, 'not-accepted']])
        expect(bodenfeuchte(NOW + 31 * DAY).inProgress[0].declinedChange).toBeUndefined()
    })

    it('shows no entry that was not accepted for a version that is listed (S12)', () => {
        const tabs = shareTabs(
            [
                row('baeume', '1.0.0', {
                    bundle: onBase(),
                    catalog: { state: 'listed' },
                    proposals: [turnedDown('catalog', 8), proposal('bundle', 1, 'merged', sourced)],
                }),
            ],
            { instance: HERE, now: NOW },
        )
        expect(tabs.published).toHaveLength(1)
        expect(tabs.ended).toEqual([])
    })

    it('keeps a version the catalogue team took out as taken out once its proposal to come back is closed, with no new rows (U3: !27, !29, !30)', () => {
        const tabs = shareTabs(
            [
                row('baeume', '1.0.2', {
                    bundle: onBase(),
                    catalog: { state: 'withdrawn', takenOut: { version: '1.0.2' } },
                    proposals: [turnedDown('catalog', 27), proposal('catalog', 5, 'merged', sourced), proposal('bundle', 1, 'merged', sourced)],
                }),
            ],
            { instance: HERE, person: 'Ewa', now: NOW },
        )
        expect(tabs.inProgress).toEqual([])
        expect(tabs.ended.map((entry) => entry.ending)).toEqual(['taken-out'])
    })

    it('adds no "not accepted" entry row under a whole entry taken out either (S9), but keeps a withdrawn one', () => {
        const tabs = shareTabs(
            [
                row('baeume', '1.1.0', {
                    bundle: onBase(),
                    catalog: { state: 'withdrawn', takenOut: { version: '1.0.0' } },
                    proposals: [turnedDown('catalog', 30), turnedDown('catalog', 29, { withdrawnBy: 'Ewa' }), proposal('bundle', 1, 'merged', sourced)],
                }),
            ],
            { instance: HERE, person: 'Ewa', now: NOW },
        )
        expect(tabs.inProgress.map((tabbed) => tabbed.outcome)).toEqual(['entry-revoked'])
        expect(tabs.ended.map((entry) => [entry.proposal?.iid, entry.ending])).toEqual([
            [29, 'withdrawn'],
            [undefined, 'taken-out'],
        ])
    })

    it('makes a close by the account whose comments could not be read nobody’s move: it may be a withdrawal of the time before the mark', () => {
        const unsure = (kind: ShareProposal['kind']) => turnedDown(kind, 14, { closedByBot: true, closedBy: 'walkable.cities.2021', reason: { kind: 'unreadable' } })
        const tabs = shareTabs([row('pegel', '1.0.0', { bundleMr: { url: `${WEB}/14`, state: 'closed' }, proposals: [unsure('bundle')] })], { instance: HERE, person: 'Ewa', now: NOW })
        // As until rc.6: an ending in „Beendet“, until the next reading tells which it was.
        expect(tabs.inProgress).toEqual([])
        expect(tabs.counts.mine).toBe(0)
        expect(tabs.ended.map((entry) => entry.ending)).toEqual(['not-accepted'])
        // A reviewer's close is a "no" whatever its comments say, and the marketplace never withdraws a removal.
        expect(declineIsCurrent({ ...unsure('bundle'), closedByBot: false }, '1.0.0', [], HERE, NOW)).toBe(true)
        expect(declineIsCurrent(unsure('removal'), '1.0.0', [], HERE, NOW)).toBe(true)
        expect(declineIsCurrent(unsure('catalog'), '1.0.0', [], HERE, NOW)).toBe(false)
    })

    it('reads a version shared again after its removal afresh: a "no" to it is a "no", and its review is no change of an accepted one', () => {
        const accepted = proposal('bundle', 3, 'merged', { createdAt: '2026-10-01T10:00:00Z', mergedAt: '2026-10-02T10:00:00Z', ...sourced })
        const removed = proposal('removal', 6, 'merged', { createdAt: '2026-10-10T10:00:00Z', mergedAt: '2026-10-11T10:00:00Z', ...sourced })
        const again = turnedDown('bundle', 9, { createdAt: '2026-10-15T10:00:00Z' })
        const tabs = shareTabs([row('pegel', '1.0.0', { bundleMr: { url: `${WEB}/9`, state: 'closed' }, proposals: [again, removed, accepted] })], { instance: HERE, person: 'Ewa', now: NOW })
        expect(tabs.inProgress.map((tabbed) => [tabbed.outcome, tabbed.mine, tabbed.declined?.decline.iid])).toEqual([['declined', true, 9]])
        const waiting = row('pegel', '1.0.0', { ...open, proposals: [proposal('bundle', 9, 'opened', { createdAt: '2026-10-15T10:00:00Z' }), removed, accepted] })
        expect(rowOutcome(waiting)).toBe('in-review')
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
