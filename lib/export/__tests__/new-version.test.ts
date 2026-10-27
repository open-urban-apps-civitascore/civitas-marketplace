import { describe, expect, it } from 'vitest'

import type { Decline } from '@/lib/export/declines'
import type { MergeRequestRef } from '@/lib/export/gitlab'
import { inProgressHref } from '@/lib/export/in-progress-items'
import { shareSourceLine, shareSourceOf, withdrawalMark, withdrawalMarkIn } from '@/lib/export/merge-request-text'
import {
    asksWhatChanged,
    blockingRows,
    BUSY_BLOCKER,
    busyBeside,
    busyRefusal,
    CHANGE_NOTE_MAX,
    changeNoteProblem,
    datasetStage,
    entryUsedUpRefusal,
    filledNotice,
    fillVersionOf,
    followedDecline,
    followedFact,
    followedHere,
    followsLine,
    followsRefOf,
    nameTakenIn,
    openSharesOf,
    parseFollows,
    proposedVersionsIn,
    sameVersionAgain,
    sharedPackageOf,
    stageHint,
    stageNotice,
    startingBasics,
    steckbriefFromManifest,
    suggestedVersion,
    unfilledNotice,
    usedVersions,
    versionBelow,
    whatChangedLead,
    whatChangedRefusal,
    wizardStart,
    type ListingFacts,
} from '@/lib/export/new-version'
import type { ShareProposal, SharedPackageRow } from '@/lib/export/share-listing'
import { shareTabs } from '@/lib/export/share-tabs'
import type { ExportSource } from '@/lib/export/sources'

const HERE = 'https://portal.hier.example'
const THERE = 'https://portal.dev.example'
const WEB = 'https://gitlab.example/group/catalog/-/merge_requests'
/** When the tests read the listing: a "no" is measured against it. */
const NOW = Date.parse('2026-10-22T12:00:00Z')

const sourced = (instance = HERE, id = 'ds-baeume') => ({ source: { kind: 'dataset' as const, id, instance } })
const proposal = (kind: ShareProposal['kind'], iid: number, state: string, extra: Partial<ShareProposal> = {}): ShareProposal => ({
    kind,
    iid,
    url: `${WEB}/${iid}`,
    state,
    createdAt: '2026-10-01T10:00:00Z',
    ...sourced(),
    ...extra,
})

/** One version of the package „baeume“ as the listing reads it: shared from dataset ds-baeume here, by Ewa. */
const version = (number: string, iid: number, state: string, facts: Partial<SharedPackageRow> = {}): SharedPackageRow => ({
    key: `t#export/baeume-${number}`,
    targetKey: 't',
    targetLabel: 'Ablage',
    slug: 'baeume',
    version: number,
    displayName: 'Baumkataster',
    bundleMr: { url: `${WEB}/${iid}`, state },
    ...sourced(),
    proposedBy: 'Ewa',
    proposals: [proposal('bundle', iid, state)],
    ...facts,
})
const onBase = { state: 'on-base' as const, packageId: 'urn:stadt:usecase:baeume', verification: { state: 'verified' as const } }

const listed = (number: string, iid: number) => version(number, iid, 'merged', { bundle: onBase, catalog: { state: 'listed' } })
const accepted = (number: string, iid: number) => version(number, iid, 'merged', { bundle: onBase, catalog: { state: 'none' } })
const inReview = (number: string, iid: number, facts: Partial<SharedPackageRow> = {}) => version(number, iid, 'opened', facts)
/** The package turned down by a reviewer the day before NOW (S1). */
const turnedDown = (number: string, iid: number, extra: Partial<ShareProposal> = {}) =>
    version(number, iid, 'closed', {
        proposals: [proposal('bundle', iid, 'closed', { closedAt: '2026-10-21T10:00:00Z', closedBy: 'spaudanjo', reason: { kind: 'given', text: 'Bitte mit Lizenz.' }, ...extra })],
    })
const withdrawn = (number: string, iid: number) =>
    version(number, iid, 'closed', {
        withdrawn: true,
        proposals: [proposal('bundle', iid, 'closed', { closedAt: '2026-10-21T10:00:00Z', closedBy: 'walkable.cities.2021', closedByBot: true, withdrawnBy: 'Ewa' })],
    })
/** The entry closed through the marketplace's account, as !32 was (S5, S10). */
const entryNo: Decline = { iid: 32, mrUrl: `${WEB}/32`, closedAt: '2026-10-22T10:00:28Z', closedBy: 'walkable.cities.2021', viaMarketplace: true, reason: { kind: 'none' } }
const entryTurnedDown = (number: string, iid: number) =>
    version(number, iid, 'merged', {
        bundle: onBase,
        catalog: { state: 'declined', mrUrl: entryNo.mrUrl, declined: entryNo },
        proposals: [proposal('catalog', 32, 'closed', { closedAt: entryNo.closedAt, closedBy: entryNo.closedBy, closedByBot: true, reason: { kind: 'none' } }), proposal('bundle', iid, 'merged')],
    })
const removalTurnedDown = (number: string, iid: number) =>
    version(number, iid, 'merged', {
        bundle: { ...onBase, removal: { state: 'closed', mrUrl: `${WEB}/40`, declined: { iid: 40, mrUrl: `${WEB}/40`, closedAt: '2026-10-21T10:00:00Z', reason: { kind: 'none' } } } },
        catalog: { state: 'none' },
        proposals: [proposal('removal', 40, 'closed', { closedAt: '2026-10-21T10:00:00Z', closedBy: 'spaudanjo' }), proposal('bundle', iid, 'merged')],
    })
const takenOut = (number: string, iid: number, out = number) =>
    version(number, iid, 'merged', { bundle: onBase, catalog: { state: 'withdrawn', takenOut: { version: out, reason: 'Veraltet.' } } })
/** Taken out of the repository again through a removal; `listedOnce`: its entry was in the catalogue before. */
const removed = (number: string, iid: number, listedOnce = false) =>
    version(number, iid, 'merged', {
        bundle: { state: 'none', reason: 'no-package', removal: { state: 'merged', mrUrl: `${WEB}/${iid + 1}` } },
        proposals: [
            proposal('removal', iid + 1, 'merged', { createdAt: '2026-10-10T10:00:00Z', mergedAt: '2026-10-11T10:00:00Z' }),
            ...(listedOnce ? [proposal('catalog', iid + 2, 'merged')] : []),
            proposal('bundle', iid, 'merged'),
        ],
    })

/** The listing as „Auswählen“ gets it: the rows, and what the tab rules make busy. */
const facts = (rows: SharedPackageRow[]): ListingFacts => ({ rows, busy: shareTabs(rows, { instance: HERE, person: 'Ewa', now: NOW }).busy, instance: HERE })
const pkgOf = (rows: SharedPackageRow[]) => sharedPackageOf(rows, { datasetId: 'ds-baeume' }, HERE)
const DATASET: ExportSource = { id: 'ds-baeume', name: 'Baumkataster Mitte' }

describe('the package a dataset was shared as (R7: by dataset id, else by short name)', () => {
    it('finds it by the dataset in this instance’s source lines, with every version of the package from any instance, highest first', () => {
        const rows = [listed('1.0.0', 1), inReview('1.1.0', 2, sourced(THERE, 'ds-dort')), turnedDown('1.0.1', 3)]
        const pkg = pkgOf(rows)
        expect(pkg).toMatchObject({ targetKey: 't', slug: 'baeume' })
        expect(pkg?.versions.map((fact) => `${fact.version} ${fact.outcome}`)).toEqual(['1.1.0 in-review', '1.0.1 declined', '1.0.0 listed'])
    })

    it('falls back to the short name, never to another instance’s dataset of the same id, nor by name alone to its package', () => {
        const rows = [listed('1.0.0', 1), inReview('1.1.0', 2)].map((row) => ({ ...row, ...sourced(THERE) }))
        expect(sharedPackageOf(rows, { datasetId: 'ds-baeume' }, HERE)).toBeUndefined()
        // Nothing is guessed from a name (plan, section 10.1): a dataset made here is no new version of another instance's package.
        expect(sharedPackageOf(rows, { datasetId: 'ds-baeume', slug: 'Baeume ' }, HERE)).toBeUndefined()
        // Where the name is the package's own - a link naming it, an installed dataset, the folder a form writes to.
        expect(sharedPackageOf(rows, { datasetId: 'ds-baeume', slug: 'Baeume ', anyInstance: true }, HERE)?.versions.map((fact) => fact.version)).toEqual(['1.1.0', '1.0.0'])
        // In the place named, where one is.
        expect(sharedPackageOf(rows, { slug: 'baeume', targetKey: 'anderswo', anyInstance: true }, HERE)).toBeUndefined()
        // Older shares name no instance: they count as this one's, by dataset and by name.
        const older = [{ ...listed('1.0.0', 1), source: { kind: 'dataset' as const, id: 'ds-baeume' } }]
        expect(pkgOf(older)?.slug).toBe('baeume')
        expect(sharedPackageOf([{ ...listed('1.0.0', 1), source: undefined }], { slug: 'baeume' }, HERE)?.slug).toBe('baeume')
    })

    it('takes, of two packages one dataset was shared as, the one proposed last', () => {
        const old = { ...listed('1.0.0', 1), slug: 'baeume-alt', key: 't#export/baeume-alt-1.0.0' }
        const renamed = { ...inReview('1.0.0', 2), proposals: [proposal('bundle', 2, 'opened', { createdAt: '2026-10-20T10:00:00Z' })] }
        expect(pkgOf([old, renamed])?.slug).toBe('baeume')
    })
})

describe('the version a new one is suggested at (R6)', () => {
    it('is one above the highest version listed, taken out, accepted, turned down or open', () => {
        const rows = [listed('1.0.0', 1), accepted('1.0.1', 2), turnedDown('1.0.2', 3), inReview('1.0.3', 4)]
        expect(suggestedVersion(pkgOf(rows))).toBe('1.0.4')
        expect(suggestedVersion(pkgOf([listed('1.0.0', 1), takenOut('1.2.0', 2)]))).toBe('1.2.1')
        // The catalogue names a version taken out that left the repository since: used up all the same.
        expect(usedVersions(pkgOf([accepted('1.0.0', 1), takenOut('1.1.0', 2, '1.3.0')])!)).toEqual(expect.arrayContaining(['1.0.0', '1.1.0', '1.3.0']))
    })

    it('leaves out what decided nothing: a withdrawal, a removal, a version gone again', () => {
        const rows = [listed('1.0.0', 1), withdrawn('1.0.5', 5), removed('1.0.6', 6)]
        expect(usedVersions(pkgOf(rows)!)).toEqual(['1.0.0'])
        expect(suggestedVersion(pkgOf(rows))).toBe('1.0.1')
    })

    it('counts a version whose entry was turned down or got in, also once it left the repository (decided 22.10.)', () => {
        // S5, then „Zurückziehen“ and the removal accepted: the same number would be accepted as a package again, and its entry refused for good (R2).
        const entryNoThenRemoved = removed('1.0.0', 1)
        entryNoThenRemoved.proposals = [proposal('catalog', 32, 'closed', { closedAt: entryNo.closedAt, closedBy: 'spaudanjo', reason: { kind: 'none' } }), ...(entryNoThenRemoved.proposals ?? [])]
        expect(suggestedVersion(pkgOf([entryNoThenRemoved]))).toBe('1.0.1')
        expect(sameVersionAgain(pkgOf([entryNoThenRemoved]), '1.0.0')).toBe(false)
        // Listed once, then gone from the repository by hand: the catalogue's floor refuses it.
        const listedThenGone = version('1.2.0', 4, 'merged', { bundle: { state: 'none', reason: 'no-package' }, proposals: [proposal('catalog', 6, 'merged'), proposal('bundle', 4, 'merged')] })
        expect(suggestedVersion(pkgOf([listed('1.0.0', 1), listedThenGone]))).toBe('1.2.1')
        // An entry closed through the account whose comments could not be read may have been withdrawn (U4): it uses up nothing.
        const unsure = removed('1.3.0', 7)
        unsure.proposals = [proposal('catalog', 9, 'closed', { closedByBot: true, closedBy: 'walkable.cities.2021', reason: { kind: 'unreadable' } }), ...(unsure.proposals ?? [])]
        expect(sameVersionAgain(pkgOf([unsure]), '1.3.0')).toBe(true)
    })

    it('starts at 1.0.0 for a package nothing of which was shared, else above the catalogue’s version of an installed dataset', () => {
        expect(suggestedVersion(undefined)).toBe('1.0.0')
        expect(suggestedVersion(undefined, ['1.0.2'])).toBe('1.0.3')
        expect(suggestedVersion(pkgOf([turnedDown('1.0.0', 1)]), ['2.0.0'])).toBe('2.0.1')
    })
})

describe('what a new version starts from', () => {
    it('fills the Steckbrief from the highest version proposed, whatever became of it, but not one that could not be read', () => {
        expect(fillVersionOf(pkgOf([listed('1.0.0', 1), withdrawn('1.1.0', 2)]))).toBe('1.1.0')
        expect(fillVersionOf(pkgOf([listed('1.0.0', 1), { ...inReview('1.1.0', 2), problem: 'GitLab-Fehler (500)' }]))).toBe('1.0.0')
        expect(fillVersionOf(undefined)).toBeUndefined()
    })

    it('lets the same version go once more only after a withdrawal, or a removal before it reached the catalogue („Erneut einreichen“)', () => {
        const pkg = pkgOf([withdrawn('1.0.0', 1), removed('1.1.0', 2), removed('1.2.0', 4, true), turnedDown('1.3.0', 7), accepted('1.4.0', 8)])
        expect(['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '9.9.9'].map((number) => sameVersionAgain(pkg, number))).toEqual([true, true, false, false, false, false])
        expect(sameVersionAgain(undefined, '1.0.0')).toBe(false)
    })
})

describe('the "no" a new version follows (R7)', () => {
    it('is the package turned down at its highest version, and asks what changed only above it', () => {
        const followed = followedDecline(pkgOf([listed('1.0.0', 1), turnedDown('1.0.1', 14)]))
        expect(followed).toMatchObject({ version: '1.0.1', kind: 'package', decline: { iid: 14, closedBy: 'spaudanjo' } })
        expect(['1.0.2', '1.1.0', '1.0.1', '1.0.0'].map((number) => asksWhatChanged(followed, number))).toEqual([true, true, false, false])
        expect(followedFact(followed!)).toBe('Version 1.0.1 hat das Katalog-Team am 21.10. nicht angenommen')
    })

    it('is the entry turned down, told as a close through the marketplace’s account where it was one (S5, S10: !32)', () => {
        const followed = followedDecline(pkgOf([entryTurnedDown('1.1.4', 30)]))
        expect(followed).toEqual({ version: '1.1.4', kind: 'entry', decline: entryNo })
        expect(followedFact(followed!)).toBe('Der Katalog-Eintrag für Version 1.1.4 wurde am 22.10. nicht angenommen (über das Marktplatz-Konto geschlossen)')
        expect(followedFact({ ...followed!, decline: { ...entryNo, viaMarketplace: false, closedBy: 'spaudanjo' } })).toBe(
            'Den Katalog-Eintrag für Version 1.1.4 hat das Katalog-Team am 22.10. nicht angenommen',
        )
        expect(whatChangedLead(followed!)).toBe(
            'Die neue Version folgt auf Vorschlag !32: Der Katalog-Eintrag für Version 1.1.4 wurde am 22.10. nicht angenommen (über das Marktplatz-Konto geschlossen). ' +
                'Schreib kurz, was sie anders macht - das Katalog-Team liest es im neuen Vorschlag.',
        )
    })

    it('is none after a withdrawal, which decides nothing (R8) - a "no" below one still is the last decision', () => {
        expect(followedDecline(pkgOf([withdrawn('1.0.0', 1)]))).toBeUndefined()
        expect(followedDecline(pkgOf([listed('1.0.0', 1), withdrawn('1.0.1', 2)]))).toBeUndefined()
        expect(followedDecline(pkgOf([turnedDown('1.0.0', 1), withdrawn('1.0.1', 2)]))).toMatchObject({ version: '1.0.0', kind: 'package' })
    })

    it('is the entry turned down where the version left the repository since, and none after another instance’s "no"', () => {
        const gone = removed('1.0.0', 1)
        gone.proposals = [proposal('catalog', 32, 'closed', { closedAt: entryNo.closedAt, closedBy: 'spaudanjo', reason: { kind: 'given', text: 'Bitte mit Lizenz.' } }), ...(gone.proposals ?? [])]
        expect(followedDecline(pkgOf([gone]), HERE)).toMatchObject({ version: '1.0.0', kind: 'entry', decline: { iid: 32, closedBy: 'spaudanjo' } })
        // Another instance's proposal turned down, the last decision about the package: nobody here can say what changed since.
        const theirs = turnedDown('1.0.1', 14, sourced(THERE))
        expect(followedDecline(pkgOf([listed('1.0.0', 1), theirs]), HERE)).toBeUndefined()
        expect(followedDecline(pkgOf([listed('1.0.0', 1), turnedDown('1.0.1', 14)]), HERE)).toMatchObject({ version: '1.0.1', kind: 'package' })
        // One that names no instance counts as this one's (U1 is about In Arbeit, not about what a new version answers).
        const unnamed = { ...turnedDown('1.0.1', 14, { source: { kind: 'dataset', id: 'ds-baeume' } }), source: { kind: 'dataset' as const, id: 'ds-baeume' } }
        expect(followedDecline(pkgOf([unnamed]), HERE)).toMatchObject({ version: '1.0.1' })
    })

    it('is none once a higher version was accepted, nor where the "no" may be a withdrawal whose comments could not be read (U4)', () => {
        expect(followedDecline(pkgOf([turnedDown('1.0.0', 1), accepted('1.0.1', 2)]))).toBeUndefined()
        expect(followedDecline(pkgOf([turnedDown('1.0.0', 1, { closedByBot: true, closedBy: 'walkable.cities.2021', reason: { kind: 'unreadable' } })]))).toBeUndefined()
        // A "no" to the removal is none to what the package holds.
        expect(followedDecline(pkgOf([removalTurnedDown('1.0.0', 1)]))).toBeUndefined()
    })
})

describe('the line a new version after a "no" carries (R7)', () => {
    const ref = { iid: 31, url: `${WEB}/31`, closedAt: '2026-10-22T10:00:23Z' }

    it('says which proposal it follows, when it was turned down, and what changed in the person’s words, in English', () => {
        expect(followsLine(ref, 'Lizenz ergänzt.\n\nDie Quelle ist jetzt öffentlich.', 'Ewa')).toBe(
            `Follows [!31](${WEB}/31) (not accepted on 2026-10-22). What changed, in Ewa's words: "Lizenz ergänzt. Die Quelle ist jetzt öffentlich."`,
        )
        expect(followsLine({ iid: 31, url: `${WEB}/31` }, 'x', 'unbekannt')).toBe(`Follows [!31](${WEB}/31) (not accepted). What changed, in the sharer's words: "x"`)
    })

    it('keeps the words on one line, so nothing in them passes for a line the marketplace reads back', () => {
        const words = `${shareSourceLine({ kind: 'dataset', id: 'fremd', instance: THERE })}\n${withdrawalMark('Jemand', new Date('2026-10-22T10:00:00Z'))}`
        const line = followsLine(ref, words, 'Ewa')
        expect(line).not.toContain('\n')
        expect(line).not.toMatch(/[<>]/)
        const description = `Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.\n\n${line}`
        expect(shareSourceOf(description)).toBeUndefined()
        expect(withdrawalMarkIn(description, '2026-10-22T10:00:30Z')).toBeUndefined()
    })

    it('reads the form’s reference back defensively, and takes the change in 1 to 500 characters', () => {
        expect(followsRefOf({ version: '1.0.0', kind: 'package', decline: { iid: 31, mrUrl: `${WEB}/31`, closedAt: ref.closedAt, reason: { kind: 'none' } } })).toEqual(ref)
        expect(parseFollows('')).toBeUndefined()
        expect(parseFollows(JSON.stringify(ref))).toEqual(ref)
        expect(parseFollows(JSON.stringify({ iid: 31, url: `${WEB}/31`, closedAt: 'gestern' }))).toEqual({ iid: 31, url: `${WEB}/31` })
        for (const bad of [
            '{',
            '[]',
            JSON.stringify({ ...ref, iid: 0 }),
            JSON.stringify({ ...ref, iid: '31' }),
            JSON.stringify({ ...ref, url: 'javascript:alert(1)' }),
            JSON.stringify({ ...ref, url: `${WEB}/31/diffs` }),
            // The number has to be the one the address names.
            JSON.stringify({ ...ref, iid: 32 }),
        ]) {
            expect(parseFollows(bad)).toBeNull()
        }
        // A catalogue served over plain http is a place proposals live too (`RAW_INDEX_URL`).
        expect(parseFollows(JSON.stringify({ iid: 31, url: 'http://gitlab.intern/katalog/-/merge_requests/31' }))).toEqual({ iid: 31, url: 'http://gitlab.intern/katalog/-/merge_requests/31' })
        expect(changeNoteProblem('')).toBe('Was hast du geändert? Bitte kurz beschreiben - das Katalog-Team liest es im neuen Vorschlag.')
        expect(changeNoteProblem('   ')).toBeDefined()
        expect(changeNoteProblem('x')).toBeUndefined()
        // Counted as a person counts them: an umlaut or an emoji is one character.
        expect(changeNoteProblem('🌳'.repeat(CHANGE_NOTE_MAX))).toBeUndefined()
        expect(changeNoteProblem('ä'.repeat(CHANGE_NOTE_MAX + 1))).toBe('Was hast du geändert? Bitte höchstens 500 Zeichen.')
    })
})

describe('where a dataset stands in „Auswählen“ (plan of 2026-10-18, section 3 b/c; decided 22.10.)', () => {
    it('greys out a dataset with a proposal open, and says where it goes on', () => {
        const rows = [listed('1.0.0', 1), inReview('1.1.0', 2)]
        const stage = datasetStage(DATASET, facts(rows))
        expect(stage.kind).toBe('busy')
        expect(stageHint(stage)).toBe('In Arbeit (1.1.0) - nicht wählbar')
        expect(stageNotice(stage, DATASET.name)).toEqual({
            text: 'Für „Baumkataster Mitte“ läuft schon ein Vorschlag (Version 1.1.0, Paket-Prüfung). Weiter geht es unter „In Arbeit“.',
            link: { label: 'Zu „In Arbeit“', href: inProgressHref(rows[1]) },
        })
        expect(inProgressHref(rows[1])).toMatch(/^\/export#in-arbeit-baeume-1\.1\.0-[a-z0-9]+$/)
        // A started share does not free it while the proposal is open: the server refuses meanwhile.
        expect(datasetStage(DATASET, facts(rows), { started: true }).kind).toBe('busy')
    })

    it('greys out one accepted without an entry, unless the new version is that row’s own way on, or a share started here', () => {
        const rows = [accepted('1.1.0', 2)]
        const stage = datasetStage(DATASET, facts(rows))
        expect(stage.kind).toBe('busy')
        expect(stageNotice(stage, DATASET.name)?.text).toBe(
            'Für „Baumkataster Mitte“ ist Version 1.1.0 angenommen, steht aber noch nicht im Katalog. Weiter geht es unter „In Arbeit“ - dort schlägst du den Katalog-Eintrag vor oder teilst eine neue Version.',
        )
        // Where the row has another next step - the folder changed since the review, say - it says so there.
        const changed = version('1.1.0', 2, 'merged', { bundle: { ...onBase, verification: { state: 'changed-after-merge' } }, catalog: { state: 'none' } })
        expect(stageNotice(datasetStage(DATASET, facts([changed])), DATASET.name)?.text).toBe(
            'Für „Baumkataster Mitte“ ist Version 1.1.0 angenommen, steht aber noch nicht im Katalog. Weiter geht es unter „In Arbeit“ - dort steht, was als Nächstes geht.',
        )
        // „Neue Version teilen“ on its row names it; a link naming the same number of another package does not.
        expect(datasetStage(DATASET, facts(rows), { from: { version: '1.1.0', slug: 'baeume' } }).kind).toBe('none')
        expect(datasetStage(DATASET, facts(rows), { from: { version: '1.1.0' } }).kind).toBe('none')
        expect(datasetStage(DATASET, facts(rows), { from: { version: '1.1.0', slug: 'anderes' } }).kind).toBe('busy')
        expect(datasetStage(DATASET, facts(rows), { started: true }).kind).toBe('none')
        expect(blockingRows(undefined)).toEqual([])
    })

    it('greys out one whose removal was turned down, like any accepted version (S8)', () => {
        expect(stageHint(datasetStage(DATASET, facts([removalTurnedDown('1.0.0', 1)])))).toBe('In Arbeit (1.0.0) - nicht wählbar')
    })

    it('keeps one whose package or entry was turned down a choice: the way on is a new version', () => {
        const stage = datasetStage(DATASET, facts([listed('1.0.0', 1), turnedDown('1.0.1', 14)]))
        expect(stage.kind).toBe('declined')
        expect(stageHint(stage)).toBe('Version 1.0.1 nicht angenommen - du teilst eine neue Version')
        expect(stageNotice(stage, DATASET.name)).toEqual({
            text: 'Version 1.0.1 hat das Katalog-Team am 21.10. nicht angenommen. Du teilst eine neue Version - im Steckbrief schreibst du dazu, was du geändert hast.',
        })
        // Ewa's case: the entry of 1.1.4, closed through the marketplace's account (!32) - the package itself was accepted.
        expect(stageHint(datasetStage(DATASET, facts([entryTurnedDown('1.1.4', 30)])))).toBe('Katalog-Eintrag für 1.1.4 nicht angenommen - du teilst eine neue Version')
    })

    it('tells nothing of another instance’s "no": its people answer it, and here it shows only as a count', () => {
        const elsewhere = { ...turnedDown('1.0.1', 14), ...sourced(THERE) }
        elsewhere.proposals = elsewhere.proposals?.map((one) => ({ ...one, ...sourced(THERE) }))
        const stage = datasetStage(DATASET, facts([listed('1.0.0', 1), elsewhere]))
        expect(stage).toEqual({ kind: 'listed', version: '1.0.0', name: 'Baumkataster' })
        // Its version is used up all the same: the suggestion is above it.
        expect(suggestedVersion(pkgOf([listed('1.0.0', 1), elsewhere]))).toBe('1.0.2')
    })

    it('keeps one whose version was taken out a choice, with the catalogue team’s word first (decided 18.10.)', () => {
        const stage = datasetStage(DATASET, facts([takenOut('1.0.0', 1)]))
        expect(stage).toEqual({ kind: 'taken-out', takenOut: { version: '1.0.0', reason: 'Veraltet.' }, whole: false })
        expect(stageHint(stage)).toBe('Version 1.0.0 aus dem Katalog genommen - du teilst eine neue Version')
        expect(stageNotice(stage, DATASET.name)?.text).toBe('Das Katalog-Team hat Version 1.0.0 aus dem Katalog genommen. Grund: Veraltet. Frag dort nach, bevor du eine neue Version teilst.')
    })

    it('says where the whole entry was taken out that no version gets in until the catalogue team lets it in again (S9)', () => {
        const stage = datasetStage(DATASET, facts([takenOut('1.0.0', 1), version('1.1.0', 2, 'merged', { bundle: onBase, catalog: { state: 'withdrawn', takenOut: { version: '1.0.0', reason: 'Veraltet' } } })]))
        expect(stage).toEqual({ kind: 'taken-out', takenOut: { version: '1.0.0', reason: 'Veraltet' }, whole: true })
        expect(stageHint(stage)).toBe('Ganzer Eintrag aus dem Katalog genommen - frag beim Katalog-Team nach')
        expect(stageNotice(stage, DATASET.name)?.text).toBe(
            'Das Katalog-Team hat den ganzen Eintrag aus dem Katalog genommen (zuletzt Version 1.0.0). Grund: Veraltet. ' +
                'Auch eine neue Version kommt erst in den Katalog, wenn das Katalog-Team ihn wieder freigibt - frag dort nach, bevor du eine neue Version teilst.',
        )
    })

    it('makes one in the catalogue an update, also one installed from there and never shared from here', () => {
        const stage = datasetStage(DATASET, facts([listed('1.0.2', 1)]))
        expect(stageHint(stage)).toBe('Im Katalog als 1.0.2 - du teilst eine neue Version')
        expect(stageNotice(stage, DATASET.name)?.text).toBe(
            '„Baumkataster“ steht schon im Katalog (Version 1.0.2). Du teilst eine neue Version - die bisherige bleibt im Katalog, bis das Katalog-Team die neue aufnimmt.',
        )
        const installed: ExportSource = {
            ...DATASET,
            catalog: { id: 'urn:stadt:usecase:jungbaum', displayName: 'Jungbaumbewässerung', description: '', version: '1.1.3', maintainer: '', license: 'EUPL-1.2', keywords: [], metadata: {} },
        }
        expect(datasetStage(installed, facts([]))).toEqual({ kind: 'listed', version: '1.1.3', name: 'Jungbaumbewässerung' })
    })

    it('says nothing of one nothing was shared of', () => {
        const stage = datasetStage(DATASET, facts([]))
        expect(stage).toEqual({ kind: 'none' })
        expect(stageHint(stage)).toBeUndefined()
        expect(stageNotice(stage, DATASET.name)).toBeUndefined()
    })

    it('warns where its short name is another instance’s package: it would become a new version of that one', () => {
        const theirs = { ...listed('1.0.2', 1), slug: 'baumkataster-mitte', key: 't#export/baumkataster-mitte-1.0.2', ...sourced(THERE, 'ds-dort') }
        const stage = datasetStage(DATASET, facts([theirs]))
        expect(stage).toMatchObject({ kind: 'name-taken', slug: 'baumkataster-mitte', pkg: { slug: 'baumkataster-mitte' } })
        // Nothing in the dropdown: it says where this dataset stands, and nothing of it was shared.
        expect(stageHint(stage)).toBeUndefined()
        expect(stageNotice(stage, DATASET.name)?.text).toBe(
            'Unter dem Kurznamen „baumkataster-mitte“ hat schon eine andere Instanz ein Paket geteilt. Wähl im Steckbrief unter „Adresse ändern“ einen eigenen Kurznamen - sonst wird dein Paket eine neue Version davon.',
        )
        // The Steckbrief asks the same of the short name typed: not where this instance shared into that package too.
        expect(nameTakenIn([theirs], 'Baumkataster-Mitte', HERE, 't')?.slug).toBe('baumkataster-mitte')
        expect(nameTakenIn([theirs], 'baumkataster-mitte', HERE, 'anderswo')).toBeUndefined()
        expect(nameTakenIn([theirs, { ...theirs, version: '1.0.3', key: 'k2', ...sourced(HERE) }], 'baumkataster-mitte', HERE)).toBeUndefined()
        expect(nameTakenIn([theirs], 'eichen', HERE)).toBeUndefined()
    })
})

describe('the Steckbrief a new version starts with', () => {
    const manifest = JSON.stringify({
        id: 'urn:stadt:usecase:baeume',
        displayName: 'Baumkataster',
        description: 'Alle Stadtbäume.',
        version: '1.0.1',
        maintainer: 'Stadt Musterbach',
        license: 'EUPL-1.2',
        keywords: ['bäume', 'grün'],
        themes: ['umwelt-klima'],
        contact: { email: 'amt@musterbach.example' },
        implementation: { collaboration: { wanted: false } },
        media: [{ src: 'https://bilder.example/karte.png', alt: 'Karte' }],
        members: {},
    })

    it('copies every field of a share from this instance, and only the package’s own of any other (D12)', () => {
        const full = steckbriefFromManifest(manifest, { full: true, domain: 'environment' })
        expect(full).toEqual({
            displayName: 'Baumkataster',
            description: 'Alle Stadtbäume.',
            publisher: 'stadt',
            slug: 'baeume',
            domain: 'environment',
            maintainer: 'Stadt Musterbach',
            license: 'EUPL-1.2',
            keywords: 'bäume, grün',
            metadata: {
                themes: ['umwelt-klima'],
                contact: { email: 'amt@musterbach.example' },
                implementation: { collaboration: { wanted: false } },
                media: [{ src: 'https://bilder.example/karte.png', alt: 'Karte' }],
            },
            full: true,
        })
        const restricted = steckbriefFromManifest(manifest, { full: false })
        expect(restricted).toMatchObject({ displayName: 'Baumkataster', maintainer: 'Stadt Musterbach', metadata: { themes: ['umwelt-klima'] }, full: false })
        expect(typeof restricted !== 'string' && restricted.metadata).toEqual({ themes: ['umwelt-klima'] })
        expect(typeof restricted !== 'string' && 'domain' in restricted).toBe(false)
        expect(steckbriefFromManifest('{', { full: true })).toBe('manifest.json ist kein gültiges JSON.')
    })

    it('puts a shared version’s fields over the catalogue’s and the defaults, at the version suggested', () => {
        const filled = steckbriefFromManifest(manifest, { full: true, domain: 'environment' })
        if (typeof filled === 'string') throw new Error(filled)
        const defaults = { publisher: 'openurbanapps', maintainer: 'Ewa' }
        expect(startingBasics(DATASET, defaults, { fill: filled, version: '1.0.2' })).toEqual({
            displayName: 'Baumkataster',
            description: 'Alle Stadtbäume.',
            slug: 'baeume',
            publisher: 'stadt',
            version: '1.0.2',
            domain: 'environment',
            maintainer: 'Stadt Musterbach',
            license: 'EUPL-1.2',
            keywords: 'bäume, grün',
            changeNote: '',
        })
        // Nothing shared, nothing read yet: as before rc.7.
        expect(startingBasics({ ...DATASET, description: 'Bäume' }, defaults)).toEqual({
            displayName: 'Baumkataster Mitte',
            description: 'Bäume',
            slug: 'baumkataster-mitte',
            publisher: 'openurbanapps',
            version: '1.0.0',
            domain: 'general',
            maintainer: 'Ewa',
            license: 'EUPL-1.2',
            keywords: '',
            changeNote: '',
        })
    })

    it('says where the fields came from, and why some stay empty or none could be taken', () => {
        expect(filledNotice({ from: '1.0.1', full: true })).toBe('Die Angaben sind aus Version 1.0.1 übernommen.')
        expect(filledNotice({ from: '1.0.1', full: false })).toBe(
            'Die Angaben sind aus Version 1.0.1 übernommen - bis auf Umsetzung, Kontakt, Kosten, Wirkungslogik, Kooperation und Bilder. ' +
                'Diese Abschnitte beschreiben die Umsetzung bei der Instanz, die Version 1.0.1 geteilt hat, und welche das war, ist nicht zu erkennen. Ergänze sie für deine Instanz, soweit du sie kennst.',
        )
        expect(filledNotice({ from: '1.0.1', full: false, elsewhere: true })).toContain('die Version 1.0.1 geteilt hat, und das war eine andere. Ergänze sie')
        expect(unfilledNotice('1.0.1', 'GitLab antwortet nicht')).toBe(
            'Die Angaben aus Version 1.0.1 ließen sich nicht übernehmen: GitLab antwortet nicht. Die Felder sind vorbelegt wie bei einem neuen Paket.',
        )
        expect(unfilledNotice('1.0.1', undefined)).toBe('Die Angaben aus Version 1.0.1 ließen sich nicht übernehmen. Die Felder sind vorbelegt wie bei einem neuen Paket.')
    })
})

describe('how the wizard starts a new version (`wizardStart`)', () => {
    const TARGETS = ['t']
    const installed: ExportSource = {
        ...DATASET,
        catalog: { id: 'urn:stadt:usecase:baeume', displayName: 'Baumkataster', description: '', version: '1.0.4', maintainer: '', license: 'EUPL-1.2', keywords: [], metadata: {} },
    }

    it('suggests the next free version and fills the Steckbrief from the package’s highest, in its place', () => {
        const start = wizardStart(DATASET, facts([listed('1.0.0', 1), turnedDown('1.0.1', 14)]), {}, TARGETS)
        expect(start).toMatchObject({ stage: { kind: 'declined' }, suggested: '1.0.2', version: '1.0.2', fill: { targetKey: 't', slug: 'baeume', version: '1.0.1' } })
        // Above the catalogue's version of an installed dataset too.
        expect(wizardStart(installed, facts([listed('1.0.0', 1)]), {}, TARGETS).version).toBe('1.0.5')
    })

    it('starts from the version and package a link names, and keeps the version for „Erneut einreichen“ only where it is not used up', () => {
        const rows = [listed('1.0.0', 1), withdrawn('1.1.0', 2), turnedDown('1.2.0', 3)]
        expect(wizardStart(DATASET, facts(rows), { from: { version: '1.1.0', slug: 'baeume', again: true } }, TARGETS)).toMatchObject({
            version: '1.1.0',
            fill: { targetKey: 't', slug: 'baeume', version: '1.1.0' },
        })
        expect(wizardStart(DATASET, facts(rows), { from: { version: '1.2.0', slug: 'baeume', again: true } }, TARGETS).version).toBe('1.2.1')
        // Before the listing answers, the link is taken at its word; the server checks on submit. The only place there is fills it.
        expect(wizardStart(DATASET, undefined, { from: { version: '1.2.0', slug: 'baeume', again: true } }, TARGETS)).toEqual({
            version: '1.2.0',
            fill: { targetKey: 't', slug: 'baeume', version: '1.2.0' },
        })
        // With several places and no listing, nothing to ask: `prepareNewVersion` takes only the exact one.
        expect(wizardStart(DATASET, undefined, { from: { version: '1.2.0', slug: 'baeume' } }, ['t', 'u']).fill).toBeUndefined()
    })

    it('fills nothing for a busy dataset, next to a share started here, or from another instance’s package found by name', () => {
        expect(wizardStart(DATASET, facts([inReview('1.1.0', 2)]), {}, TARGETS)).toMatchObject({ stage: { kind: 'busy' } })
        expect(wizardStart(DATASET, facts([inReview('1.1.0', 2)]), {}, TARGETS).fill).toBeUndefined()
        expect(wizardStart(DATASET, facts([listed('1.0.0', 1)]), { started: true }, TARGETS).fill).toBeUndefined()
        const theirs = { ...listed('1.0.2', 1), slug: 'baumkataster-mitte', key: 't#export/baumkataster-mitte-1.0.2', ...sourced(THERE, 'ds-dort') }
        const start = wizardStart(DATASET, facts([theirs]), {}, TARGETS)
        // Its folder all the same: the suggestion is above its versions, so the default short name is not refused.
        expect(start).toMatchObject({ stage: { kind: 'name-taken' }, suggested: '1.0.3' })
        expect(start.pkg).toBeUndefined()
        expect(start.fill).toBeUndefined()
    })
})

describe('a busy dataset at the Steckbrief and the preview (a link or a race)', () => {
    it('counts the proposals open beside the form’s own, not the version it submitted, nor one accepted without an entry', () => {
        const tabbed = facts([inReview('1.1.0', 2), inReview('1.2.0', 3), accepted('1.0.0', 1)]).busy.get('ds-baeume') ?? []
        expect(busyBeside(tabbed, { targetKey: 't', slug: 'Baeume', version: '1.2.0' }).map((row) => row.row.version)).toEqual(['1.1.0'])
        expect(busyBeside(tabbed, { targetKey: 'anderswo', slug: 'baeume', version: '1.2.0' }).map((row) => row.row.version)).toEqual(['1.1.0', '1.2.0'])
        expect(BUSY_BLOCKER).toBe('Für diesen Datensatz läuft schon ein Vorschlag - weiter geht es unter „In Arbeit“.')
    })
})

describe('R7 on the server: the "no" a new version follows, as GitLab tells it', () => {
    const packageNo: Decline = { iid: 14, mrUrl: `${WEB}/14`, closedAt: '2026-10-21T10:00:00Z', closedBy: 'spaudanjo', reason: { kind: 'none' } }

    it('finds the version a new one comes after, and its "no" from here or from an instance that names none', () => {
        expect(versionBelow(['1.0.0', '1.2.0', '1.1.0', '2.0.0'], '1.5.0')).toBe('1.2.0')
        expect(versionBelow(['1.5.0'], '1.5.0')).toBeUndefined()
        const here = `Proposed by …\n\n${shareSourceLine({ kind: 'dataset', id: 'ds-baeume', instance: HERE })}`
        expect(followedHere('1.1.0', 'package', packageNo, here, HERE)).toEqual({ version: '1.1.0', kind: 'package', decline: packageNo })
        expect(followedHere('1.1.0', 'package', packageNo, 'Proposed by …', HERE)).toMatchObject({ version: '1.1.0' })
        expect(followedHere('1.1.0', 'package', packageNo, shareSourceLine({ kind: 'dataset', id: 'x', instance: THERE }), HERE)).toBeUndefined()
        // Closed through the account, its comments unread: maybe a withdrawal (U4), which asks nothing.
        expect(followedHere('1.1.0', 'entry', { ...entryNo, reason: { kind: 'unreadable' } }, here, HERE)).toBeUndefined()
        expect(followedHere('1.1.0', 'entry', undefined, here, HERE)).toBeUndefined()
    })

    it('says why it refuses: the "no" followed, where to write what changed, and the way on for an entry used up', () => {
        expect(whatChangedRefusal({ version: '1.1.0', kind: 'package', decline: packageNo })).toBe(
            'Nicht eingereicht: Version 1.1.0 hat das Katalog-Team am 21.10. nicht angenommen. Schreib im Steckbrief unter „Was hast du geändert?“, was die neue Version anders macht - das Katalog-Team liest es im neuen Vorschlag.',
        )
        expect(entryUsedUpRefusal({ version: '1.1.4', kind: 'entry', decline: entryNo }, '1.1.5')).toBe(
            'Nicht eingereicht: Der Katalog-Eintrag für Version 1.1.4 wurde am 22.10. nicht angenommen (über das Marktplatz-Konto geschlossen). Trag im Steckbrief eine höhere Version ein, zum Beispiel 1.1.5.',
        )
    })
})

describe('the server’s side', () => {
    const BOT = 42
    const request = (iid: number, branch: string, facts: Partial<MergeRequestRef> = {}): MergeRequestRef => ({
        iid,
        web_url: `${WEB}/${iid}`,
        state: 'opened',
        source_branch: branch,
        author: { id: BOT },
        description: `Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.\n\n${shareSourceLine({ kind: 'dataset', id: 'ds-baeume', instance: HERE })}`,
        ...facts,
    })

    it('finds the account’s open proposals of a dataset - package, entry or removal - from this instance or one that names none', () => {
        const requests = [
            request(1, 'export/baeume-1.1.0'),
            request(2, 'catalog/baeume-1.0.0'),
            request(3, 'remove/baeume-0.9.0', { description: shareSourceLine({ kind: 'dataset', id: 'ds-baeume' }) }),
            // Not counted: closed, by someone else, another dataset, another instance, no source line, a branch not the marketplace's.
            request(4, 'export/baeume-1.2.0', { state: 'closed' }),
            request(5, 'export/baeume-1.3.0', { author: { id: 7 } }),
            request(6, 'export/baeume-1.4.0', { description: shareSourceLine({ kind: 'dataset', id: 'ds-anders', instance: HERE }) }),
            request(7, 'export/baeume-1.5.0', { description: shareSourceLine({ kind: 'dataset', id: 'ds-baeume', instance: THERE }) }),
            request(8, 'export/baeume-1.6.0', { description: 'Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.' }),
            request(9, 'feature/baeume-1.7.0'),
        ]
        expect(openSharesOf(requests, 'ds-baeume', BOT, HERE)).toEqual([
            { kind: 'bundle', slug: 'baeume', version: '1.1.0', iid: 1, url: `${WEB}/1` },
            { kind: 'catalog', slug: 'baeume', version: '1.0.0', iid: 2, url: `${WEB}/2` },
            { kind: 'removal', slug: 'baeume', version: '0.9.0', iid: 3, url: `${WEB}/3` },
        ])
        expect(busyRefusal(openSharesOf(requests, 'ds-baeume', BOT, HERE)[1])).toBe(
            'Nicht eingereicht: Für diesen Datensatz läuft schon ein Vorschlag (Version 1.0.0, Eintrags-Prüfung, Vorschlag !2). Eine neue Version geht erst, wenn er entschieden oder zurückgezogen ist - weiter geht es unter „In Arbeit“.',
        )
    })

    it('counts as used up every version of the package the account proposed, but one withdrawn by the mark (R6 in the refusals)', () => {
        const requests = [
            request(1, 'export/baeume-1.0.0', { state: 'merged' }),
            request(2, 'export/baeume-1.0.1', { state: 'closed', closed_at: '2026-10-21T10:00:00Z' }),
            request(3, 'export/baeume-1.0.2', { state: 'closed', closed_at: '2026-10-21T10:00:00Z', description: withdrawalMark('Ewa', new Date('2026-10-21T10:00:00Z')) }),
            request(4, 'export/baeume-1.0.3'),
            request(5, 'export/baeume-2.0.0', { author: { id: 7 } }),
            request(6, 'export/eichen-3.0.0'),
            request(7, 'catalog/baeume-4.0.0'),
        ]
        expect(proposedVersionsIn(requests, 'baeume', BOT)).toEqual(['1.0.0', '1.0.1', '1.0.3'])
    })
})
