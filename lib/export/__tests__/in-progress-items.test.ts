import { describe, expect, it, vi } from 'vitest'

// `proposerName` sits beside the right check, which would reach for the session.
vi.mock('@/lib/session', () => ({ getAccessToken: vi.fn(async () => 'test-token') }))

import {
    ACTION_LABELS,
    GROUP_LEADS,
    GROUP_TITLES,
    groupOf,
    inProgressItems,
    isMine,
    keptOrder,
    keptPlaces,
    placesOf,
    rowView,
    shownGroups,
    turnOf,
    whoseMove,
    withPlace,
    withSlot,
    type InProgressItem,
    type Placed,
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

/** A view as a table row: the line's marks, the sentence, the team's words, the move and the quiet actions. */
const summary = (view: RowView) => ({
    track: view.track?.map((step) => step.mark),
    status: view.status.text,
    tone: view.status.tone,
    reasons: view.reasons?.map((reason) => reason.text),
    main: view.main && `${view.main.look}:${view.main.kind}`,
    quiet: view.quiet.map((action) => action.kind),
})

/** The plan's table „Stage → action“ (section 4), with the "no"s of 2026-10-22 (3.3), as data. */
const TABLE: [string, { track?: TrackMark[]; status: string; tone?: string; reasons?: string[]; main?: string; quiet: string[] }][] = [
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
    // The catalogue team's "no" (2026-10-22, 3.3), here without a reason: the move is what is left to do.
    [
        'declined',
        {
            track: ['done', 'problem', 'later', 'later'],
            status: 'Paket-Prüfung (2 von 4) - nicht angenommen am 21.10. · du bist dran: eine neue Version teilen',
            reasons: ['Ohne Begründung.'],
            main: 'button:new-version',
            quiet: [],
        },
    ],
    [
        'entry-declined',
        {
            track: ['done', 'done', 'done', 'problem'],
            status: 'Eintrags-Prüfung (4 von 4) - nicht angenommen am 21.10. · du bist dran: bei Bedarf eine neue Version teilen',
            reasons: ['Ohne Begründung.'],
            main: 'button:new-version',
            quiet: ['withdraw'],
        },
    ],
    [
        'removal-declined',
        {
            track: undefined,
            status:
                'Entfernen am 21.10. nicht angenommen - das Paket bleibt angenommen, im Katalog steht es nicht · du bist dran: Katalog-Eintrag vorschlagen oder eine neue Version teilen',
            tone: 'neutral',
            reasons: ['Ohne Begründung.'],
            main: undefined,
            quiet: ['propose-entry', 'new-version'],
        },
    ],
    [
        'entry-revoked',
        {
            track: ['done', 'done', 'problem', 'later'],
            status: 'Katalog-Eintrag (3 von 4) - der ganze Eintrag ist aus dem Katalog genommen · weiter geht es erst, wenn das Katalog-Team ihn wieder freigibt',
            reasons: ['Das Katalog-Team hat Version 1.0.0 aus dem Katalog genommen.'],
            main: 'link:gitlab',
            quiet: ['withdraw'],
        },
    ],
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

    it('leads waiting stages to their proposal at GitLab, and „Neue Version teilen“ to the dataset in the wizard, filled from this version', () => {
        expect(rowView(itemOf(STAGE_ROWS['in-review']), DATASETS).main?.href).toBe(`${WEB}/31`)
        expect(rowView(itemOf(STAGE_ROWS['entry-in-review']), DATASETS).main?.href).toBe(`${WEB}/8`)
        expect(rowView(itemOf(STAGE_ROWS['removal-pending']), DATASETS).main?.href).toBe(`${WEB}/40`)
        expect(rowView(itemOf(STAGE_ROWS.accepted), DATASETS).quiet[0]).toEqual({
            kind: 'new-version',
            look: 'quiet',
            href: '/export/new?source=dataset:ds-a&from=1.1.0&package=a',
        })
        // A dataset that is not here (any more): the wizard, to choose one for this version.
        expect(rowView(itemOf(STAGE_ROWS.accepted), new Map()).quiet[0].href).toBe('/export/new?from=1.1.0&package=a')
        expect(ACTION_LABELS['new-version']).toBe('Neue Version teilen')
    })

    it('leads a "no" to the proposal the catalogue team turned down from their words, a whole entry taken out to the package’s', () => {
        const proposalOf = (stage: string) => rowView(itemOf(STAGE_ROWS[stage]), DATASETS).reasons?.[0].link
        // Heard with its number, so two such links in one card are told apart (S4 beside S5 or S8).
        expect(proposalOf('declined')).toEqual({ label: 'Vorschlag ansehen', href: `${WEB}/31`, heard: ' (!31)' })
        expect(proposalOf('entry-declined')).toEqual({ label: 'Vorschlag ansehen', href: `${WEB}/8`, heard: ' (!8)' })
        expect(proposalOf('removal-declined')).toEqual({ label: 'Vorschlag ansehen', href: `${WEB}/40`, heard: ' (!40)' })
        // The way on after a "no" is a new version of the dataset (S1, S5).
        expect(rowView(itemOf(STAGE_ROWS.declined), DATASETS).main).toEqual({ kind: 'new-version', look: 'button', href: '/export/new?source=dataset:ds-a&from=1.1.0&package=a' })
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

    it('puts under „Du bist dran“ exactly what the tab rules and the rows call the person’s own', () => {
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
            expect(items.filter((item) => groupOf(item) === 'yours').length, person).toBe(tabs.counts.mine)
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

describe('a "no" in „In Arbeit“ (2026-10-22, 3.3)', () => {
    const DAY = 24 * 60 * 60 * 1000
    const viewOf = (shared: SharedPackageRow, person = 'Ewa', now = NOW) => rowView(itemOf(shared, person, now), DATASETS)
    /** A turned-down proposal with the team's words, or with words that could not be read. */
    const withReason = (kind: ShareProposal['kind'], iid: number, reason: ShareProposal['reason']): ShareProposal => ({ ...turnedDown(kind, iid), reason })

    it('tells a package turned down with the reviewer’s words, and the move as reading them and sharing a new version (S1)', () => {
        const view = viewOf(row('a', { bundleMr: { url: `${WEB}/31`, state: 'closed' }, proposals: [withReason('bundle', 31, { kind: 'given', text: 'Die Datenquelle ist nicht öffentlich.' })] }))
        expect(view.status.text).toBe('Paket-Prüfung (2 von 4) - nicht angenommen am 21.10. · du bist dran: Grund lesen und eine neue Version teilen')
        expect(view.reasons).toEqual([{ text: 'Grund (spaudanjo): „Die Datenquelle ist nicht öffentlich.“', link: { label: 'Vorschlag ansehen', href: `${WEB}/31`, heard: ' (!31)' } }])
        // A colleague's: named, with the same move.
        expect(viewOf(row('a', { bundleMr: { url: `${WEB}/31`, state: 'closed' }, proposals: [turnedDown('bundle', 31)] }), 'Kim').status.text).toBe(
            'Paket-Prüfung (2 von 4) - nicht angenommen am 21.10. · Ewa ist dran: eine neue Version teilen',
        )
    })

    it('says that the reason could not be read, never that there was none (U4)', () => {
        const view = viewOf(row('a', { bundle: onBase(), catalog: { state: 'declined', mrUrl: `${WEB}/8`, declined: declineOf(8) }, proposals: [withReason('catalog', 8, { kind: 'unreadable' }), merged31] }))
        expect(view.reasons?.[0].text).toBe('Der Grund ließ sich gerade nicht lesen.')
        expect(view.status.text).toBe('Eintrags-Prüfung (4 von 4) - nicht angenommen am 21.10. · du bist dran: Grund lesen und bei Bedarf eine neue Version teilen')
    })

    it('tells the entry closed through the marketplace’s account as such, never as the team’s decision (S5, S10: !31 and !32)', () => {
        const viaAccount = (iid: number, closedAt: string) =>
            proposal('catalog', iid, 'closed', {
                createdAt: closedAt.replace(/:..Z$/, ':00Z'),
                closedAt,
                closedByBot: true,
                closedBy: 'walkable.cities.2021',
                comments: 0,
                reason: { kind: 'none' },
                source: { kind: 'dataset', id: 'ds-a', instance: HERE },
            })
        const musterbach = row('jungbaumbewaesserung-musterbach', {
            version: '1.1.4',
            bundle: onBase(),
            catalog: { state: 'declined', mrUrl: `${WEB}/32`, declined: { iid: 32, mrUrl: `${WEB}/32`, closedAt: '2026-10-22T09:41:28Z', viaMarketplace: true, reason: { kind: 'none' } } },
            proposals: [viaAccount(32, '2026-10-22T09:41:28Z'), viaAccount(31, '2026-10-22T09:37:23Z'), merged31],
        })
        const view = viewOf(musterbach)
        expect(summary(view)).toEqual({
            track: ['done', 'done', 'done', 'problem'],
            status: 'Eintrags-Prüfung (4 von 4) - nicht angenommen am 22.10. · du bist dran: bei Bedarf eine neue Version teilen',
            tone: 'plain',
            reasons: ['Über das Marktplatz-Konto geschlossen, ohne Begründung.'],
            main: 'button:new-version',
            quiet: ['withdraw'],
        })
        expect(view.reasons?.[0].link?.href).toBe(`${WEB}/32`)
        // No „Katalog-Eintrag vorschlagen“: the entry is used up for 1.1.4 (R2).
        expect([view.main, ...view.quiet].map((action) => action?.kind)).not.toContain('propose-entry')
        expect(JSON.stringify(view)).not.toContain('Katalog-Team')
    })

    it('tells a reason given through the marketplace’s account without a name, after saying it was one', () => {
        const view = viewOf(
            row('a', {
                bundleMr: { url: `${WEB}/31`, state: 'closed' },
                proposals: [{ ...turnedDown('bundle', 31), closedByBot: true, closedBy: 'walkable.cities.2021', reason: { kind: 'given', text: 'Doppelt eingereicht.' } }],
            }),
        )
        expect(view.reasons?.[0].text).toBe('Über das Marktplatz-Konto geschlossen. Grund: „Doppelt eingereicht.“')
    })

    it('keeps a removal turned down as nobody’s move after its time, with the line as it stands and the entry still on offer (S8)', () => {
        const removalNo = (extra: Partial<ShareProposal> = {}, catalog: SharedPackageRow['catalog'] = { state: 'none' }) =>
            row('a', {
                bundle: onBase({ removal: { state: 'closed', mrUrl: `${WEB}/40`, declined: declineOf(40) } }),
                catalog,
                proposals: [{ ...turnedDown('removal', 40), ...extra }, merged31],
            })
        const later = NOW + 31 * DAY
        // Afterwards the sentence alone: the team's words stay in „Beendet“ (3.3, S8 "afterwards").
        expect(summary(viewOf(removalNo(), 'Ewa', later))).toEqual({
            track: ['done', 'done', 'later', 'later'],
            status: 'Paket angenommen, nicht im Katalog - das Entfernen hat das Katalog-Team am 21.10. nicht angenommen',
            tone: 'plain',
            reasons: undefined,
            main: undefined,
            quiet: ['propose-entry'],
        })
        expect(viewOf(removalNo({ closedByBot: true, closedBy: 'walkable.cities.2021' }), 'Ewa', later).status.text).toBe(
            'Paket angenommen, nicht im Katalog - das Entfernen wurde am 21.10. nicht angenommen (über das Marktplatz-Konto geschlossen)',
        )
        // While it is news, with a reason: reading it is the move.
        expect(viewOf(removalNo({ reason: { kind: 'given', text: 'Wird noch gebraucht.' } })).status.text).toBe(
            'Entfernen am 21.10. nicht angenommen - das Paket bleibt angenommen, im Katalog steht es nicht · du bist dran: Grund lesen',
        )
        // Not where the entry could not be proposed anyway: then the move is a new version, during the 30 days and after.
        const unconfigured = removalNo({}, { state: 'unconfigured' })
        expect(viewOf(unconfigured).quiet.map((action) => action.kind)).toEqual(['new-version'])
        expect(viewOf(unconfigured, 'Ewa', later).quiet.map((action) => action.kind)).toEqual(['new-version'])
    })

    it('offers no entry the catalogue team turned down already, when they turned down its removal after it (S5, then S8)', () => {
        // The entry turned down on 10.10., the removal proposed from that row and turned down on 21.10.: the later "no" is the row's.
        const both = row('a', {
            bundle: onBase({ removal: { state: 'closed', mrUrl: `${WEB}/40`, declined: declineOf(40) } }),
            catalog: { state: 'declined', mrUrl: `${WEB}/8`, declined: { ...declineOf(8), closedAt: '2026-10-10T10:00:00.000Z' } },
            proposals: [turnedDown('removal', 40), { ...turnedDown('catalog', 8), closedAt: '2026-10-10T10:00:00.000Z' }, merged31],
        })
        const during = itemOf(both)
        expect(during).toMatchObject({ outcome: 'removal-declined' })
        const actions = (view: RowView) => [view.main, ...view.quiet].map((action) => action?.kind)
        expect(actions(rowView(during, DATASETS))).not.toContain('propose-entry')
        expect(rowView(during, DATASETS).status.text).toMatch(/· du bist dran: eine neue Version teilen$/)
        // After its 30 days it leaves „In Arbeit“, as the entry's "no" alone does (S5): nothing is left to move on but a
        // new version, which „Auswählen“ starts. „Beendet“ keeps both "no"s.
        const after = shareTabs([both], { instance: HERE, person: 'Ewa', now: NOW + 31 * DAY })
        expect(after.inProgress).toEqual([])
        expect(after.ended.map((entry) => `${entry.what}:${entry.ending}`)).toEqual(['removal:not-accepted', 'catalog:not-accepted'])
    })

    it('notes a change to the accepted version the catalogue team did not take, and leaves the row’s move as it is (S4)', () => {
        const bodenfeuchte = (extra: Partial<ShareProposal> = {}) =>
            row('a', {
                bundle: onBase(),
                catalog: { state: 'none' },
                proposals: [{ ...turnedDown('bundle', 21), reason: { kind: 'given', text: 'Bitte als neue Version.' }, ...extra }, merged31],
            })
        const view = viewOf(bodenfeuchte())
        expect(summary(view)).toMatchObject({
            status: 'Katalog-Eintrag (3 von 4) - Paket angenommen · du bist dran: Katalog-Eintrag vorschlagen',
            reasons: ['Die Änderung an Version 1.1.0 (Vorschlag !21) hat das Katalog-Team am 21.10. nicht angenommen. Grund (spaudanjo): „Bitte als neue Version.“'],
            main: 'button:propose-entry',
        })
        expect(view.reasons?.[0].link).toEqual({ label: 'Vorschlag ansehen', href: `${WEB}/21`, heard: ' (!21)' })
        // What was closed is the proposal, not the change: the account is named apart.
        expect(viewOf(bodenfeuchte({ closedByBot: true, closedBy: 'walkable.cities.2021', reason: { kind: 'none' } })).reasons?.[0].text).toBe(
            'Die Änderung an Version 1.1.0 (Vorschlag !21) wurde am 21.10. nicht angenommen (über das Marktplatz-Konto geschlossen). Ohne Begründung.',
        )
        // After its 30 days the note is gone.
        expect(viewOf(bodenfeuchte(), 'Ewa', NOW + 31 * DAY).reasons).toBeUndefined()
    })

    it('says that the catalogue team changed the package before they took it, with where to see it (S3)', () => {
        const view = viewOf(row('a', { bundle: onBase({ verification: { state: 'verified', changedInReview: true, mergedMrUrl: `${WEB}/30` } }), catalog: { state: 'none' } }))
        expect(view.status).toEqual({
            text: 'Katalog-Eintrag (3 von 4) - Paket angenommen, das Katalog-Team hat dabei etwas geändert · du bist dran: Katalog-Eintrag vorschlagen',
            tone: 'plain',
            link: { label: 'Änderung ansehen', href: `${WEB}/30/commits` },
        })
        expect(view.main).toEqual({ kind: 'propose-entry', look: 'button' })
    })

    it('lists the older versions turned down among the earlier ones of the newer version, once it took their place (S14)', () => {
        const versioned = (version: string, facts: Partial<SharedPackageRow>) => row('a', { key: `t#export/a-${version}`, version, ...facts })
        const rows = [
            versioned('1.1.5', { bundleMr: { url: `${WEB}/40`, state: 'opened' }, proposals: [proposal('bundle', 40, 'opened')] }),
            versioned('1.1.4', { bundle: onBase(), catalog: { state: 'declined', mrUrl: `${WEB}/32`, declined: declineOf(32) }, proposals: [turnedDown('catalog', 32), merged31] }),
            versioned('1.1.3', { bundle: { state: 'none', reason: 'other-version', onBase: { id: 'urn:x:usecase:a', version: '1.1.4' } } }),
        ]
        const tabs = shareTabs(rows, { instance: HERE, person: 'Ewa', now: NOW })
        expect(tabs.inProgress.map((tabbed) => tabbed.row.version)).toEqual(['1.1.5'])
        expect(rowView(inProgressItems([], DATASETS, tabs.inProgress)[0], DATASETS).earlier).toBe('Frühere Versionen: 1.1.3 · 1.1.4 nicht angenommen')
    })

    // S11's own sentence („… - wieder geöffnet, wartet auf das Katalog-Team“) is not told: GitLab names a reopen only in a
    // further read per open proposal, which rc.7 does not make. What is pinned here is the state: back to waiting.
    it('reads a proposal the team opened again as waiting, with no word of the "no" - the plain waiting sentence (S11)', () => {
        const reopened = row('a', { ...open, proposals: [proposal('bundle', 31, 'opened', { source: { kind: 'dataset', id: 'ds-a', instance: HERE } })] })
        const view = viewOf(reopened)
        expect(view.status.text).toBe('Paket-Prüfung (2 von 4) - wartet auf das Katalog-Team · Vorschlag !31')
        expect(view.reasons).toBeUndefined()
    })
})

describe('the groups of „In Arbeit“', () => {
    it('puts the person’s moves under „Du bist dran“, everyone else’s under „Wartet auf andere“, and what could not be read apart', () => {
        expect(groupOf(itemOf(STAGE_ROWS.accepted))).toBe('yours')
        expect(groupOf(itemOf(STAGE_ROWS.accepted, 'Kim'))).toBe('others')
        expect(groupOf(itemOf(STAGE_ROWS['in-review']))).toBe('others')
        // Nobody here can move these on: someone else has to - the operator, the catalogue team.
        expect(groupOf(itemOf(STAGE_ROWS.broken))).toBe('others')
        expect(groupOf(itemOf(STAGE_ROWS['entry-revoked']))).toBe('others')
        expect(groupOf(itemOf(STAGE_ROWS.unreadable))).toBe('unreadable')
        expect(groupOf(inProgressItems([draft('d')], DATASETS, [])[0])).toBe('yours')
        expect([GROUP_TITLES.yours, GROUP_TITLES.others, GROUP_TITLES.unreadable]).toEqual(['Du bist dran', 'Wartet auf andere', 'Stand nicht lesbar'])
        expect(GROUP_LEADS).toEqual({
            yours: 'Hier liegt der nächste Schritt bei dir - in jeder Zeile steht, welcher.',
            others: 'Hier ist gerade jemand anderes dran - meist das Katalog-Team, manchmal jemand aus deiner Instanz oder der Betrieb. In jeder Zeile steht, woran es hängt.',
        })
    })

    it('orders the rows by their groups, so each group is one run', () => {
        const rows = [STAGE_ROWS.unreadable, STAGE_ROWS['in-review'], STAGE_ROWS.broken, STAGE_ROWS.accepted].map((shared, index) => ({ ...shared, key: `k${index}` }))
        const items = inProgressItems([], DATASETS, shareTabs(rows, { instance: HERE, person: 'Ewa', now: NOW }).inProgress)
        expect(placesOf(items)).toEqual([
            { key: 'k3', group: 'yours' },
            { key: 'k1', group: 'others' },
            { key: 'k2', group: 'others' },
            { key: 'k0', group: 'unreadable' },
        ])
    })

    it('keeps each row in the group and place the person saw while they are inside the list, and what is new at the end of its group', () => {
        const seen: Placed[] = [
            { key: 'a', group: 'yours' },
            { key: 'b', group: 'yours' },
            { key: 'c', group: 'others' },
        ]
        // `a` was proposed meanwhile and waits now; `d` is new and the person's; `c` is gone.
        const next: Placed[] = [
            { key: 'b', group: 'yours' },
            { key: 'd', group: 'yours' },
            { key: 'a', group: 'others' },
        ]
        expect(keptPlaces(seen, next)).toEqual([
            { key: 'a', group: 'yours' },
            { key: 'b', group: 'yours' },
            { key: 'd', group: 'yours' },
        ])
        // Once focus has left, the new reading holds.
        expect(keptPlaces([], next)).toEqual(next)
    })

    it('puts a result back in the group and at the place where its row stood', () => {
        const placed: Placed[] = [
            { key: 'a', group: 'yours' },
            { key: 'c', group: 'others' },
        ]
        expect(withPlace(placed, { key: 'b', group: 'others' }, 0)).toEqual([
            { key: 'a', group: 'yours' },
            { key: 'b', group: 'others' },
            { key: 'c', group: 'others' },
        ])
        expect(withPlace(placed, { key: 'b', group: 'unreadable' }, 3)).toEqual([...placed, { key: 'b', group: 'unreadable' }])
        expect(withPlace(placed, { key: 'a', group: 'yours' }, 1)).toEqual(placed)
    })

    it('shows the two first groups also empty once all is known, „Stand nicht lesbar“ only with rows, and counts only what is known', () => {
        const placed: Placed[] = [{ key: 'c', group: 'others' }]
        expect(shownGroups(placed, 'all')).toEqual([
            { group: 'yours', keys: [], counted: true },
            { group: 'others', keys: ['c'], counted: true },
        ])
        // While it is read, or after it failed, a group of none would claim what nobody knows - and a count only of the
        // started shares would be too low, as the tab bar shows none then either.
        expect(shownGroups(placed, 'partial')).toEqual([{ group: 'others', keys: ['c'], counted: false }])
        // Without the right to see what was submitted the started shares are all there is: counted, but no group of none.
        expect(shownGroups([{ key: 'draft:d', group: 'yours' }], 'own')).toEqual([{ group: 'yours', keys: ['draft:d'], counted: true }])
        expect(shownGroups([{ key: 'x', group: 'unreadable' }], 'all').map(({ group }) => group)).toEqual(['yours', 'others', 'unreadable'])
    })
})
