import { describe, expect, it, vi } from 'vitest'

// `proposerName` sits beside the right check, which would reach for the session.
vi.mock('@/lib/session', () => ({ getAccessToken: vi.fn(async () => 'test-token') }))

import {
    ACTION_LABELS,
    inProgressItems,
    isMine,
    keptOrder,
    rowView,
    turnOf,
    whoseMove,
    withSlot,
    type InProgressItem,
    type RowView,
    type TrackMark,
} from '@/lib/export/in-progress-items'
import type { ShareDraft } from '@/lib/export/share-drafts'
import type { ShareProposal, SharedPackageRow } from '@/lib/export/share-listing'
import { proposerName } from '@/lib/export/share-permission'
import { shareTabs, TAB_OF, type ShareOutcome } from '@/lib/export/share-tabs'

const HERE = 'https://portal.hier.example'
const WEB = 'https://gitlab.example/group/catalog/-/merge_requests'

const draft = (datasetId: string, savedAt = '2026-10-17T10:00:00.000Z'): ShareDraft => ({
    datasetId,
    datasetName: `Datensatz ${datasetId}`,
    savedAt,
    startedAt: '2026-10-12T10:00:00.000Z',
    step: 2,
    basics: {},
    metadata: { fields: {}, themes: [], media: [] },
    targetKey: 't',
    demoExcluded: [],
})

const proposal = (kind: ShareProposal['kind'], iid: number, state: string, extra: Partial<ShareProposal> = {}): ShareProposal => ({
    kind,
    iid,
    url: `${WEB}/${iid}`,
    state,
    ...extra,
})

/** One version as the listing reads it, from this instance by Ewa, its package proposed on `created`. */
const row = (slug: string, facts: Partial<SharedPackageRow> = {}, created = '2026-10-12T09:00:00.000Z'): SharedPackageRow => ({
    key: `t#export/${slug}-1.1.0`,
    targetKey: 't',
    targetLabel: 'Ablage',
    slug,
    version: '1.1.0',
    displayName: slug,
    bundleMr: { url: `${WEB}/31`, state: 'merged' },
    source: { kind: 'dataset', id: `ds-${slug}`, instance: HERE },
    proposedBy: 'Ewa',
    proposals: [proposal('bundle', 31, facts.bundleMr?.state ?? 'merged', { createdAt: created })],
    ...facts,
})

const verified = { state: 'verified' as const }
const onBase = (extra: Record<string, unknown> = {}) => ({ state: 'on-base' as const, packageId: 'urn:x:usecase:a', verification: verified, ...extra })
const open = { bundleMr: { url: `${WEB}/31`, state: 'opened' } }

/** When the tests read the listing: a "no" is measured against it. */
const NOW = Date.parse('2026-10-22T12:00:00.000Z')
/** A proposal of this instance the catalogue team closed the day before. */
const turnedDown = (kind: ShareProposal['kind'], iid: number) =>
    proposal(kind, iid, 'closed', { closedAt: '2026-10-21T10:00:00.000Z', closedBy: 'spaudanjo', reason: { kind: 'none' }, source: { kind: 'dataset', id: 'ds-a', instance: HERE } })
const merged31 = proposal('bundle', 31, 'merged', { createdAt: '2026-10-12T09:00:00.000Z' })
const declineOf = (iid: number) => ({ iid, mrUrl: `${WEB}/${iid}`, closedAt: '2026-10-21T10:00:00.000Z', reason: { kind: 'none' as const } })

/** Every stage „In Arbeit“ lists, as the listing would read it. */
const STAGE_ROWS: Record<string, SharedPackageRow> = {
    declined: row('a', { bundleMr: { url: `${WEB}/31`, state: 'closed' }, proposals: [turnedDown('bundle', 31)] }),
    'entry-declined': row('a', { bundle: onBase(), catalog: { state: 'declined', mrUrl: `${WEB}/8`, declined: declineOf(8) }, proposals: [turnedDown('catalog', 8), merged31] }),
    'removal-declined': row('a', {
        bundle: onBase({ removal: { state: 'closed', mrUrl: `${WEB}/40`, declined: declineOf(40) } }),
        catalog: { state: 'none' },
        proposals: [turnedDown('removal', 40), merged31],
    }),
    'entry-revoked': row('a', { bundle: onBase(), catalog: { state: 'withdrawn', takenOut: { version: '1.0.0' } } }),
    unreadable: row('a', { problem: 'GitLab-Fehler (500)' }),
    'in-review': row('a', open),
    'change-in-review': row('a', { ...open, proposals: [proposal('bundle', 32, 'opened'), proposal('bundle', 31, 'merged')], bundleMr: { url: `${WEB}/32`, state: 'opened' } }),
    'removal-pending': row('a', { bundle: onBase({ removal: { state: 'opened', mrUrl: `${WEB}/40` } }), catalog: { state: 'none' } }),
    accepted: row('a', { bundle: onBase(), catalog: { state: 'none' } }),
    'needs-look': row('a', {
        bundle: onBase({ verification: { state: 'changed-after-merge' } }),
        catalog: { state: 'none' },
        folderUrl: 'https://gitlab.example/group/catalog/-/commits/main/packages/a',
    }),
    broken: row('a', { bundle: { state: 'none', reason: 'bad-manifest' } }),
    'no-catalogue': row('a', { bundle: onBase(), catalog: { state: 'unconfigured' } }),
    'entry-in-review': row('a', { bundle: onBase(), catalog: { state: 'mr-open', mrUrl: `${WEB}/8` } }),
    'brings-back': row('a', { bundle: onBase(), catalog: { state: 'mr-open', mrUrl: `${WEB}/8`, takenOut: { version: '1.1.0' }, bringsBack: true } }),
}

const DATASETS = new Map([['ds-a', 'Baumkataster Mitte']])

/** The one item a row becomes for `person`, read at `now`. */
function itemOf(shared: SharedPackageRow, person = 'Ewa', now = NOW): InProgressItem {
    const [tabbed] = shareTabs([shared], { instance: HERE, person, now }).inProgress
    expect(tabbed, shared.key).toBeDefined()
    return inProgressItems([], DATASETS, [tabbed])[0]
}

/** A view as a table row: the line's marks, the sentence, the move and the quiet actions. */
const summary = (view: RowView) => ({
    track: view.track?.map((step) => step.mark),
    status: view.status.text,
    tone: view.status.tone,
    main: view.main && `${view.main.look}:${view.main.kind}`,
    quiet: view.quiet.map((action) => action.kind),
})

/** The plan's table „Stage → action“ (section 4), as data. */
const TABLE: [string, { track?: TrackMark[]; status: string; tone?: string; main?: string; quiet: string[] }][] = [
    [
        'unreadable',
        { track: undefined, status: 'Der Stand ließ sich nicht lesen: GitLab-Fehler (500)', tone: 'error', main: 'button:retry', quiet: [] },
    ],
    [
        'in-review',
        {
            track: ['done', 'waiting', 'later', 'later'],
            status: 'Paket-Prüfung (2 von 4) - wartet auf das Katalog-Team · Vorschlag !31',
            main: 'link:gitlab',
            quiet: ['withdraw'],
        },
    ],
    [
        'change-in-review',
        {
            track: ['done', 'waiting', 'later', 'later'],
            status: 'Änderung am angenommenen Paket - wartet auf das Katalog-Team · Vorschlag !32',
            main: 'link:gitlab',
            quiet: ['withdraw'],
        },
    ],
    [
        'removal-pending',
        { track: undefined, status: 'Entfernen vorgeschlagen - wartet auf das Katalog-Team', tone: 'removal', main: 'link:gitlab', quiet: [] },
    ],
    [
        'accepted',
        {
            track: ['done', 'done', 'yours', 'later'],
            status: 'Katalog-Eintrag (3 von 4) - Paket angenommen · du bist dran: Katalog-Eintrag vorschlagen',
            main: 'button:propose-entry',
            quiet: ['new-version', 'withdraw'],
        },
    ],
    [
        'needs-look',
        {
            track: ['done', 'done', 'problem', 'later'],
            status:
                'Paket angenommen, danach aber direkt in GitLab geändert - es ist nicht mehr der geprüfte Stand, deshalb lässt sich der Katalog-Eintrag nicht vorschlagen · du bist dran: Änderung ansehen und eine neue Version teilen, die wieder geprüft wird',
            main: 'button:new-version',
            quiet: ['withdraw'],
        },
    ],
    [
        'broken',
        {
            track: ['done', 'done', 'problem', 'later'],
            status: 'Paket angenommen. Die manifest.json des Pakets im Ablageort ist kein gültiges JSON.',
            main: 'link:gitlab',
            quiet: ['withdraw'],
        },
    ],
    [
        'no-catalogue',
        { track: ['done', 'done', 'waiting', 'later'], status: 'Katalog-Eintrag (3 von 4) - wartet auf den Betrieb', main: undefined, quiet: ['new-version', 'withdraw'] },
    ],
    [
        'entry-in-review',
        {
            track: ['done', 'done', 'done', 'waiting'],
            status: 'Eintrags-Prüfung (4 von 4) - wartet auf das Katalog-Team · Vorschlag !8',
            main: 'link:gitlab',
            quiet: ['withdraw'],
        },
    ],
    [
        'brings-back',
        {
            track: ['done', 'done', 'done', 'problem'],
            status:
                'Eintrags-Prüfung (4 von 4) - das Katalog-Team hat diese Version aus dem Katalog genommen, der offene Vorschlag würde sie zurückbringen · du bist dran: Vorschlag zurückziehen',
            main: 'button:withdraw',
            quiet: [],
        },
    ],
    // The catalogue team's "no" (2026-10-22): read and ordered here; the rows' own sentences come with slice B, until then the stages' summary.
    ['declined', { track: ['done', 'problem', 'later', 'later'], status: 'Nicht angenommen · du bist dran', main: 'link:gitlab', quiet: [] }],
    [
        'entry-declined',
        { track: ['done', 'done', 'done', 'problem'], status: 'Paket angenommen, Katalog-Eintrag nicht angenommen · du bist dran', main: 'link:gitlab', quiet: [] },
    ],
    [
        'removal-declined',
        { track: ['done', 'done', 'yours', 'later'], status: 'Paket angenommen - jetzt Katalog-Eintrag vorschlagen · du bist dran', main: 'link:gitlab', quiet: [] },
    ],
    ['entry-revoked', { track: ['done', 'done', 'problem', 'later'], status: 'Aus dem Katalog genommen', main: 'link:gitlab', quiet: [] }],
]

describe('the stage → action table of „In Arbeit“', () => {
    it.each(TABLE)('%s', (stage, expected) => {
        const item = itemOf(STAGE_ROWS[stage])
        expect(item).toMatchObject({ kind: 'shared', outcome: stage as ShareOutcome })
        expect(summary(rowView(item, DATASETS))).toEqual({ tone: 'plain', ...expected })
    })

    it('covers every stage the tab lists', () => {
        const listed = new Set(Object.values(STAGE_ROWS).map((shared) => (itemOf(shared) as Extract<InProgressItem, { kind: 'shared' }>).outcome))
        expect(new Set(TABLE.map(([stage]) => stage))).toEqual(listed)
        // Every outcome the tab rules send to „In Arbeit“: a new one fails here until the table has its row.
        expect(listed).toEqual(new Set(Object.entries(TAB_OF).flatMap(([outcome, tab]) => (tab === 'in-progress' ? [outcome] : []))))
    })

    it('offers a started share „Weitermachen“ at its step, and „Verwerfen“; one whose dataset is gone only „Verwerfen“', () => {
        const [started] = inProgressItems([draft('ds-a')], DATASETS, [])
        expect(summary(rowView(started, DATASETS))).toEqual({
            track: ['yours', 'later', 'later', 'later'],
            status: 'Angefangen am 12.10. - noch nicht eingereicht · du bist dran: weitermachen und zur Prüfung einreichen',
            tone: 'plain',
            main: 'button:resume',
            quiet: ['discard'],
        })
        expect(rowView(started, DATASETS).main?.href).toBe('/export/new?source=dataset:ds-a&step=steckbrief')

        const [gone] = inProgressItems([draft('gone')], DATASETS, [])
        expect(summary(rowView(gone, DATASETS))).toEqual({
            track: undefined,
            status: 'Der Datensatz „Datensatz gone“ ist auf dieser Instanz nicht mehr da.',
            tone: 'neutral',
            main: undefined,
            quiet: ['discard'],
        })
    })

    it('leads waiting stages to their proposal at GitLab, and „Neue Version teilen“ to the dataset in the wizard', () => {
        expect(rowView(itemOf(STAGE_ROWS['in-review']), DATASETS).main?.href).toBe(`${WEB}/31`)
        expect(rowView(itemOf(STAGE_ROWS['entry-in-review']), DATASETS).main?.href).toBe(`${WEB}/8`)
        expect(rowView(itemOf(STAGE_ROWS['removal-pending']), DATASETS).main?.href).toBe(`${WEB}/40`)
        expect(rowView(itemOf(STAGE_ROWS.accepted), DATASETS).quiet[0]).toEqual({ kind: 'new-version', look: 'quiet', href: '/export/new?source=dataset:ds-a' })
        // A dataset that is not here (any more): the wizard, to choose one.
        expect(rowView(itemOf(STAGE_ROWS.accepted), new Map()).quiet[0].href).toBe('/export/new')
        expect(ACTION_LABELS['new-version']).toBe('Neue Version teilen')
    })

    it('leads a "no" to the proposal the catalogue team turned down, a whole entry taken out to the package’s', () => {
        expect(rowView(itemOf(STAGE_ROWS.declined), DATASETS).main?.href).toBe(`${WEB}/31`)
        expect(rowView(itemOf(STAGE_ROWS['entry-declined']), DATASETS).main?.href).toBe(`${WEB}/8`)
        expect(rowView(itemOf(STAGE_ROWS['removal-declined']), DATASETS).main?.href).toBe(`${WEB}/40`)
        expect(rowView(itemOf(STAGE_ROWS['entry-revoked']), DATASETS).main?.href).toBe(`${WEB}/31`)
    })

    it('links the change after the review from the sentence, and the proposal that would bring an entry back', () => {
        expect(rowView(itemOf(STAGE_ROWS['needs-look']), DATASETS).status.link).toEqual({
            label: 'Änderung ansehen',
            href: 'https://gitlab.example/group/catalog/-/commits/main/packages/a',
        })
        expect(rowView(itemOf(STAGE_ROWS['brings-back']), DATASETS).status.link).toEqual({ label: 'Vorschlag ansehen', href: `${WEB}/8` })
    })

    it('says where a share came from, as far as it is known', () => {
        const view = rowView(itemOf(STAGE_ROWS['in-review']), DATASETS)
        expect(view).toMatchObject({ title: 'a', version: '1.1.0', origin: 'aus Datensatz „Baumkataster Mitte“ · eingereicht am 12.10. von Ewa' })
        const unknown = row('b', { ...open, proposedBy: undefined, proposals: [proposal('bundle', 31, 'opened')] })
        expect(rowView(itemOf(unknown), DATASETS).origin).toBeUndefined()
        const earlier = shareTabs([STAGE_ROWS.accepted, row('a', { key: 't#export/a-1.0.0', version: '1.0.0', bundle: { state: 'none', reason: 'other-version', onBase: { id: 'urn:x:usecase:a', version: '1.1.0' } } })], {
            instance: HERE,
            person: 'Ewa',
        }).inProgress
        expect(rowView(inProgressItems([], DATASETS, earlier)[0], DATASETS).earlier).toBe('Frühere Versionen: 1.0.0')
    })
})

describe('whose move it is', () => {
    it('is the person’s own only on what they proposed, and a colleague’s by name otherwise', () => {
        const mine = itemOf(STAGE_ROWS.accepted, 'Ewa')
        expect(turnOf(mine)).toBe('yours')
        expect(whoseMove(mine)).toBe('du bist dran')

        const theirs = itemOf(STAGE_ROWS.accepted, 'Kim')
        expect(turnOf(theirs)).toBe('colleague')
        expect(isMine(theirs)).toBe(false)
        expect(rowView(theirs, DATASETS).status.text).toBe('Katalog-Eintrag (3 von 4) - Paket angenommen · Ewa ist dran: Katalog-Eintrag vorschlagen')
        // Anyone with the right may still take the step.
        expect(rowView(theirs, DATASETS).main).toEqual({ kind: 'propose-entry', look: 'button' })
        // Names are compared as the person sees them, case aside.
        expect(turnOf(itemOf(STAGE_ROWS.accepted, ' ewa '))).toBe('yours')
    })

    it('is the person’s own for a "no", and after its time nobody’s - for a removal turned down, which stays listed (S8)', () => {
        for (const stage of ['declined', 'entry-declined', 'removal-declined']) {
            expect(turnOf(itemOf(STAGE_ROWS[stage])), stage).toBe('yours')
            expect(turnOf(itemOf(STAGE_ROWS[stage], 'Kim')), stage).toBe('colleague')
        }
        const later = itemOf(STAGE_ROWS['removal-declined'], 'Ewa', NOW + 31 * 24 * 60 * 60 * 1000)
        expect(later).toMatchObject({ mine: false, declined: { current: false, decline: { iid: 40 } } })
        expect(turnOf(later)).toBe('nobody')
        expect(whoseMove(later)).toBeUndefined()
        // A whole entry taken out at an earlier version: nobody here can move it on (S9).
        expect(turnOf(itemOf(STAGE_ROWS['entry-revoked']))).toBe('nobody')
    })

    it('is nobody else’s on a share that names nobody', () => {
        expect(turnOf(itemOf(row('a', { bundle: onBase(), catalog: { state: 'none' }, proposedBy: undefined }), 'Kim'))).toBe('yours')
    })

    it('is a colleague’s for a person without a name, as the withdrawal dialog tells them apart', () => {
        // The layout passes `proposerName(session.user)`: „unbekannt“ is nobody's name, so it owns no named share.
        const nameless = proposerName({ name: '  ' })
        expect(turnOf(itemOf(STAGE_ROWS.accepted, nameless))).toBe('colleague')
        expect(rowView(itemOf(STAGE_ROWS.accepted, nameless), DATASETS).status.text).toBe('Katalog-Eintrag (3 von 4) - Paket angenommen · Ewa ist dran: Katalog-Eintrag vorschlagen')
        // What they proposed themselves names nobody, and stays theirs.
        expect(turnOf(itemOf(row('a', { bundle: onBase(), catalog: { state: 'none' }, proposedBy: undefined }), nameless))).toBe('yours')
    })

    it('counts in the tab bar exactly what the rows call the person’s own', () => {
        const rows = [
            STAGE_ROWS.accepted,
            row('kims', { bundle: onBase(), catalog: { state: 'none' }, proposedBy: 'Kim' }),
            row('waiting', open),
            row('broken', { problem: 'GitLab-Fehler (500)' }),
        ].map((shared, index) => ({ ...shared, key: `${shared.key}-${index}` }))
        for (const person of ['Ewa', 'Kim', 'Lea']) {
            const tabs = shareTabs(rows, { instance: HERE, person, drafts: 1 })
            const items = inProgressItems([draft('d')], DATASETS, tabs.inProgress)
            expect(items.filter(isMine).length, person).toBe(tabs.counts.mine)
            expect(items.filter((item) => whoseMove(item) === 'du bist dran').length, person).toBe(tabs.counts.mine)
        }
    })
})

describe('the order of „In Arbeit“', () => {
    it('lists the person’s moves, then a colleague’s, then the catalogue team’s, then what nobody here can move - newest first in each', () => {
        const rows = [
            row('team-old', open, '2026-10-01T09:00:00.000Z'),
            row('colleague', { bundle: onBase(), catalog: { state: 'none' }, proposedBy: 'Kim' }),
            row('broken', { problem: 'GitLab-Fehler (500)' }),
            row('mine-old', { bundle: onBase(), catalog: { state: 'none' }, proposals: [proposal('bundle', 31, 'merged', { createdAt: '2026-10-02T09:00:00.000Z', mergedAt: '2026-10-03T09:00:00.000Z' })] }),
            row('team-new', { bundle: onBase(), catalog: { state: 'mr-open', mrUrl: `${WEB}/8` } }, '2026-10-01T09:00:00.000Z'),
            row('removing', { bundle: onBase({ removal: { state: 'opened', mrUrl: `${WEB}/40` } }), catalog: { state: 'none' } }, '2026-09-01T09:00:00.000Z'),
        ]
            .map((shared) => ({ ...shared, key: `t#export/${shared.slug}-1.1.0` }))
            // The catalogue entry was proposed later than the package: its newest change.
            .map((shared) =>
                shared.slug === 'team-new' ? { ...shared, proposals: [...(shared.proposals ?? []), proposal('catalog', 8, 'opened', { createdAt: '2026-10-15T09:00:00.000Z' })] } : shared,
            )
        const tabs = shareTabs(rows, { instance: HERE, person: 'Ewa' })
        const items = inProgressItems([draft('d-new', '2026-10-16T09:00:00.000Z'), draft('d-old', '2026-09-30T09:00:00.000Z')], DATASETS, tabs.inProgress)
        expect(items.map((item) => (item.kind === 'draft' ? item.draft.datasetId : item.row.slug))).toEqual([
            'd-new',
            'mine-old',
            'd-old',
            'colleague',
            'team-new',
            'team-old',
            'removing',
            'broken',
        ])
    })

    it('keeps the order the person saw while they are inside the list', () => {
        expect(keptOrder(['a', 'b', 'c'], ['c', 'a', 'd', 'b'])).toEqual(['a', 'b', 'c', 'd'])
        expect(keptOrder(['a', 'b', 'c'], ['c', 'a'])).toEqual(['a', 'c'])
        expect(keptOrder([], ['b', 'a'])).toEqual(['b', 'a'])
    })

    it('puts a result back where its row stood, once the row has gone to another tab', () => {
        expect(withSlot(['a', 'c'], 'b', 1)).toEqual(['a', 'b', 'c'])
        expect(withSlot(['a'], 'b', 5)).toEqual(['a', 'b'])
        expect(withSlot(['a', 'b'], 'b', 0)).toEqual(['a', 'b'])
    })
})
