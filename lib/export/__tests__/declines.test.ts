import { describe, expect, it } from 'vitest'

import {
    declinedChange,
    declinedOn,
    declinedProposal,
    declineOf,
    entryRefusal,
    laterDecline,
    mayBeWithdrawn,
    packageRefusal,
    presentProposals,
    removalRefusal,
    type Decline,
} from '@/lib/export/declines'
import { clientFor, readClosing, type MergeRequestNote, type MergeRequestRef } from '@/lib/export/gitlab'
import { withdrawalMark } from '@/lib/export/merge-request-text'
import type { ShareProposal } from '@/lib/export/share-listing'
import { inspectBundle, inspectCatalog, presentRequests, readDecline } from '@/lib/export/status'

const WEB = 'https://gitlab.example/group/catalog'

const proposal = (kind: ShareProposal['kind'], iid: number, state: string, extra: Partial<ShareProposal> = {}): ShareProposal => ({
    kind,
    iid,
    url: `${WEB}/-/merge_requests/${iid}`,
    state,
    ...extra,
})

describe('which proposal is a "no"', () => {
    it('is the newest of its kind, closed and not withdrawn', () => {
        const proposals = [proposal('catalog', 32, 'closed'), proposal('catalog', 31, 'closed'), proposal('bundle', 30, 'merged')]
        expect(declinedProposal(proposals, 'catalog')?.iid).toBe(32)
        expect(declinedProposal(proposals, 'removal')).toBeUndefined()
        expect(declinedProposal(proposals, 'bundle')).toBeUndefined()
        // Withdrawn by the person: no "no", whatever came before it (R8).
        expect(declinedProposal([proposal('bundle', 5, 'closed', { withdrawnBy: 'Ewa' }), proposal('bundle', 4, 'closed')], 'bundle')).toBeUndefined()
        // Open again: waiting, not turned down (S11).
        expect(declinedProposal([proposal('bundle', 5, 'opened'), proposal('bundle', 4, 'closed')], 'bundle')).toBeUndefined()
    })

    it('is none where anything from the branch was merged: a merge beats a later closed duplicate (U2)', () => {
        const bodenfeuchte = [proposal('bundle', 21, 'closed'), proposal('bundle', 19, 'merged')]
        expect(declinedProposal(bodenfeuchte, 'bundle')).toBeUndefined()
        // It is a change to the accepted version that was not taken (S4).
        expect(declinedChange(bodenfeuchte)?.iid).toBe(21)
        expect(declinedChange([proposal('bundle', 21, 'closed', { withdrawnBy: 'Ewa' }), proposal('bundle', 19, 'merged')])).toBeUndefined()
        expect(declinedChange([proposal('bundle', 21, 'closed')])).toBeUndefined()
    })

    it('counts what came since the version last started over: an old merge no longer beats a later "no" once a removal took it out', () => {
        const accepted = proposal('bundle', 3, 'merged', { createdAt: '2026-10-01T10:00:00Z', mergedAt: '2026-10-02T10:00:00Z' })
        const removed = proposal('removal', 6, 'merged', { createdAt: '2026-10-10T10:00:00Z', mergedAt: '2026-10-11T10:00:00Z' })
        const sharedAgain = proposal('bundle', 9, 'closed', { createdAt: '2026-10-15T10:00:00Z' })
        expect(presentProposals([sharedAgain, removed, accepted], 'bundle').map((p) => p.iid)).toEqual([9])
        expect(declinedProposal([sharedAgain, removed, accepted], 'bundle')?.iid).toBe(9)
        expect(declinedChange([sharedAgain, removed, accepted])).toBeUndefined()
        // A "no" to a change of the old acceptance is history once the version was removed: it blocks nothing.
        const changeBefore = proposal('bundle', 5, 'closed', { createdAt: '2026-10-05T10:00:00Z' })
        expect(declinedProposal([removed, changeBefore, accepted], 'bundle')).toBeUndefined()
        // Accepted again after the removal: its removals start over too, and a new "no" to removing it holds.
        const acceptedAgain = proposal('bundle', 9, 'merged', { createdAt: '2026-10-15T10:00:00Z', mergedAt: '2026-10-16T10:00:00Z' })
        const removalNo = proposal('removal', 12, 'closed', { createdAt: '2026-10-20T10:00:00Z' })
        expect(declinedProposal([removalNo, acceptedAgain, removed, accepted], 'removal')?.iid).toBe(12)
        // The catalogue entry has no such restart: what the index says decides there.
        expect(presentProposals([proposal('catalog', 8, 'merged', { createdAt: '2026-10-01T10:00:00Z' }), removed], 'catalog')).toHaveLength(1)
    })

    it('reads the requests of one branch the same way', () => {
        const ref = (iid: number, state: string, branch: string, extra: Partial<MergeRequestRef> = {}): MergeRequestRef => ({ iid, state, source_branch: branch, web_url: `u/${iid}`, ...extra })
        const accepted = ref(3, 'merged', 'export/x-1.0.0', { created_at: '2026-10-01T10:00:00Z', merged_at: '2026-10-02T10:00:00Z' })
        const sharedAgain = ref(9, 'closed', 'export/x-1.0.0', { created_at: '2026-10-15T10:00:00Z' })
        const removed = ref(6, 'merged', 'remove/x-1.0.0', { created_at: '2026-10-10T10:00:00Z', merged_at: '2026-10-11T10:00:00Z' })
        expect(presentRequests([sharedAgain, accepted], [removed]).map((mr) => mr.iid)).toEqual([9])
        expect(presentRequests([sharedAgain, accepted], [])).toHaveLength(2)
        expect(presentRequests([removed], [accepted]).map((mr) => mr.iid)).toEqual([6])
    })

    it('may be no "no" at all where the account closed it and its comments could not be read - but not for a removal', () => {
        const unsure = proposal('bundle', 5, 'closed', { closedByBot: true, reason: { kind: 'unreadable' } })
        expect(mayBeWithdrawn(unsure)).toBe(true)
        expect(mayBeWithdrawn({ ...unsure, kind: 'catalog' })).toBe(true)
        expect(mayBeWithdrawn({ ...unsure, kind: 'removal' })).toBe(false)
        expect(mayBeWithdrawn({ ...unsure, closedByBot: false })).toBe(false)
        expect(mayBeWithdrawn({ ...unsure, reason: { kind: 'none' } })).toBe(false)
    })

    it('is told with who and when, through the marketplace’s account where it closed it, and a reason never read as none given', () => {
        const closed = proposal('catalog', 32, 'closed', { closedAt: '2026-10-22T09:41:28Z', closedBy: 'walkable.cities.2021', closedByBot: true })
        expect(declineOf(closed)).toEqual({
            iid: 32,
            mrUrl: `${WEB}/-/merge_requests/32`,
            closedAt: '2026-10-22T09:41:28Z',
            closedBy: 'walkable.cities.2021',
            viaMarketplace: true,
            reason: { kind: 'none' },
        })
        expect(declineOf({ ...closed, reason: { kind: 'unreadable' } }).reason).toEqual({ kind: 'unreadable' })
    })

    it('picks the later of two, by when they were closed', () => {
        const a: Decline = { iid: 1, mrUrl: 'u/1', closedAt: '2026-10-20T10:00:00Z', reason: { kind: 'none' } }
        const b: Decline = { iid: 2, mrUrl: 'u/2', closedAt: '2026-10-21T10:00:00Z', reason: { kind: 'none' } }
        expect(laterDecline(a, b)).toBe(b)
        expect(laterDecline(b, a)).toBe(b)
        expect(laterDecline(a, undefined)).toBe(a)
        expect(laterDecline(undefined, undefined)).toBeUndefined()
        expect(laterDecline({ ...a, closedAt: undefined }, { ...b, closedAt: undefined })?.iid).toBe(2)
    })

    it('refuses in words that say who closed it: the catalogue team, or the marketplace’s account (R1-R3, S10)', () => {
        const team: Decline = { iid: 31, mrUrl: 'u/31', closedAt: '2026-10-22T10:00:00Z', closedBy: 'spaudanjo', reason: { kind: 'none' } }
        const account: Decline = { ...team, iid: 32, closedBy: 'walkable.cities.2021', viaMarketplace: true }
        expect(packageRefusal('1.0.0', team, '1.0.1')).toBe('Nicht eingereicht: Version 1.0.0 hat das Katalog-Team am 22.10. nicht angenommen. Nimm eine höhere Version, zum Beispiel 1.0.1.')
        expect(packageRefusal('1.0.0', account, '1.0.1')).toBe(
            'Nicht eingereicht: Version 1.0.0 wurde am 22.10. über das Marktplatz-Konto geschlossen und gilt als nicht angenommen. Nimm eine höhere Version, zum Beispiel 1.0.1.',
        )
        expect(entryRefusal('1.1.4', team)).toBe(
            'Kein Katalog-Eintrag: Das Katalog-Team hat den Eintrag für Version 1.1.4 am 22.10. nicht angenommen (Vorschlag !31). Für diese Version schlägt der Marktplatz ihn nicht noch einmal vor - teile eine neue Version.',
        )
        expect(entryRefusal('1.1.4', account)).toBe(
            'Kein Katalog-Eintrag: Der Eintrag für Version 1.1.4 wurde am 22.10. über das Marktplatz-Konto geschlossen und gilt als nicht angenommen (Vorschlag !32). Für diese Version schlägt der Marktplatz ihn nicht noch einmal vor - teile eine neue Version.',
        )
        expect(removalRefusal(team)).toBe(
            'Das Katalog-Team hat das Entfernen dieser Version am 22.10. nicht angenommen (Vorschlag !31). Noch einmal vorschlagen geht von hier nicht - frag beim Katalog-Team nach.',
        )
        expect(removalRefusal({ ...account, closedAt: undefined })).toBe(
            'Das Entfernen dieser Version wurde über das Marktplatz-Konto geschlossen und gilt als nicht angenommen (Vorschlag !32). Noch einmal vorschlagen geht von hier nicht - frag beim Katalog-Team nach.',
        )
    })

    it('names the day in Berlin, or nothing without a date', () => {
        expect(declinedOn({ closedAt: '2026-10-22T09:41:28Z' })).toBe(' am 22.10.')
        expect(declinedOn({ closedAt: '2026-10-21T22:30:00Z' })).toBe(' am 22.10.')
        expect(declinedOn({})).toBe('')
    })
})

interface World {
    /** Merge requests by source branch, as GitLab lists them. */
    branches: Record<string, MergeRequestRef[]>
    notes?: Record<number, MergeRequestNote[]>
    files?: Record<string, string>
    failing?: string
}

/** One project (7) that holds packages and catalogue; reads only. */
function fakeGitLab({ branches, notes = {}, files = {}, failing }: World) {
    const calls: string[] = []
    const fetchImpl = (async (input: string | URL | Request) => {
        const url = new URL(String(input))
        const path = url.pathname.replace(/^\/api\/v4/, '')
        const query = url.searchParams
        calls.push(`${path}${url.search}`)
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
        if (failing && path.includes(failing)) return json({ message: 'boom' }, 500)
        if (path === '/projects/group%2Fcatalog') return json({ id: 7, path_with_namespace: 'group/catalog', web_url: WEB, default_branch: 'main' })
        if (path === '/user') return json({ id: 42, username: 'walkable.cities.2021' })
        if (path === '/projects/7/merge_requests') {
            const branch = query.get('source_branch')
            if (branch) return json(branches[branch] ?? [])
            if (query.get('author_id') === '42') return json(Object.values(branches).flat())
        }
        const notesOf = path.match(/^\/projects\/7\/merge_requests\/(\d+)\/notes$/)?.[1]
        if (notesOf) return json(notes[Number(notesOf)] ?? [])
        if (path === '/projects/7/repository/branches/main') return json({ commit: { id: 'f'.repeat(40) } })
        if (path.startsWith('/projects/7/repository/files/')) {
            const file = decodeURIComponent(path.slice('/projects/7/repository/files/'.length).replace(/\/raw$/, ''))
            const content = files[`${query.get('ref')}|${file}`]
            return content === undefined ? new Response('', { status: 404 }) : new Response(content, { status: 200 })
        }
        return json({ message: `404 ${path}` }, 404)
    }) as typeof fetch
    return { calls, client: clientFor(WEB, 'token', fetchImpl) }
}

const TARGET = { key: WEB, label: 'Katalog', url: WEB, baseBranch: 'main', pathPrefix: 'packages' }
const BOT = { id: 42, username: 'walkable.cities.2021' }

const request = (iid: number, branch: string, state: string, extra: Partial<MergeRequestRef> = {}): MergeRequestRef => ({
    iid,
    state,
    source_branch: branch,
    web_url: `${WEB}/-/merge_requests/${iid}`,
    author: BOT,
    description: 'Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.\n\nAdds `urn:stadt:usecase:baeume` in `useCases`, pinned to …',
    created_at: '2026-10-21T10:00:00Z',
    ...extra,
})
const turnedDown = (iid: number, branch: string, extra: Partial<MergeRequestRef> = {}) =>
    request(iid, branch, 'closed', {
        closed_at: '2026-10-22T10:00:00Z',
        updated_at: '2026-10-22T10:00:00Z',
        closed_by: { id: 99, username: 'spaudanjo' },
        user_notes_count: 1,
        ...extra,
    })
const REASON = { 31: [{ body: 'Die Datenquelle ist nicht öffentlich.', author: { id: 99, username: 'spaudanjo' }, created_at: '2026-10-22T09:59:00Z' }] }

describe('readClosing', () => {
    it('reads the mark without asking for comments, and nothing where nobody wrote any', async () => {
        const marked = turnedDown(31, 'export/baeume-1.1.0', { description: `body\n\n${withdrawalMark('Ewa', new Date('2026-10-22T10:00:00Z'))}` })
        const gitlab = fakeGitLab({ branches: {} })
        expect(await readClosing(gitlab.client, 7, marked)).toEqual({ withdrawnBy: 'Ewa' })
        expect(await readClosing(gitlab.client, 7, turnedDown(31, 'export/baeume-1.1.0', { user_notes_count: 0 }))).toEqual({ reason: { kind: 'none' } })
        expect(gitlab.calls).toEqual([])
    })

    it('reads the comments for the note of the time before the mark, else for the team’s reason - and throws where they cannot be read', async () => {
        const gitlab = fakeGitLab({ branches: {}, notes: REASON })
        expect(await readClosing(gitlab.client, 7, turnedDown(31, 'export/baeume-1.1.0'))).toEqual({ reason: { kind: 'given', text: 'Die Datenquelle ist nicht öffentlich.' } })
        const old = fakeGitLab({ branches: {}, notes: { 31: [{ body: 'Withdrawn through the Open Urban Apps marketplace on behalf of **Ewa**.', author: BOT, created_at: '2026-10-22T10:00:01Z' }] } })
        expect(await readClosing(old.client, 7, turnedDown(31, 'export/baeume-1.1.0'))).toEqual({ withdrawnBy: 'Ewa' })
        await expect(readClosing(fakeGitLab({ branches: {}, failing: '/notes' }).client, 7, turnedDown(31, 'export/baeume-1.1.0'))).rejects.toMatchObject({ status: 500 })
    })
})

describe('readDecline', () => {
    it('asks for the account only where there is a closed proposal to judge', async () => {
        const gitlab = fakeGitLab({ branches: {} })
        let asked = 0
        const bot = async () => {
            asked++
            return BOT
        }
        expect(await readDecline(gitlab.client, 7, [request(30, 'export/baeume-1.1.0', 'opened')], bot)).toBeUndefined()
        expect(await readDecline(gitlab.client, 7, [turnedDown(31, 'export/baeume-1.1.0'), request(19, 'export/baeume-1.1.0', 'merged')], bot)).toBeUndefined()
        expect(asked).toBe(0)
        expect(gitlab.calls).toEqual([])
    })

    it('tells a "no" whose comments cannot be read with that reason - and fails for a refusal only where the account closed it (U4)', async () => {
        const failing = fakeGitLab({ branches: {}, failing: '/notes' })
        const byReviewer = [turnedDown(31, 'export/baeume-1.1.0')]
        const byAccount = [turnedDown(31, 'export/baeume-1.1.0', { closed_by: BOT })]
        const unreadable = { iid: 31, reason: { kind: 'unreadable' } }
        expect(await readDecline(failing.client, 7, byReviewer, async () => BOT)).toMatchObject(unreadable)
        // Only the marketplace withdraws, through its account: a reviewer's close is a "no" whatever its comments say.
        expect(await readDecline(failing.client, 7, byReviewer, async () => BOT, 'throw')).toMatchObject(unreadable)
        expect(await readDecline(failing.client, 7, byAccount, async () => BOT)).toMatchObject({ ...unreadable, viaMarketplace: true })
        await expect(readDecline(failing.client, 7, byAccount, async () => BOT, 'throw')).rejects.toMatchObject({ status: 500 })
    })

    it('judges the newest of the marketplace’s own proposals, not one someone opened by hand', async () => {
        const gitlab = fakeGitLab({ branches: {}, notes: REASON })
        const byHand = turnedDown(33, 'export/baeume-1.1.0', { author: { id: 7 }, created_at: '2026-10-22T11:00:00Z' })
        const decline = await readDecline(gitlab.client, 7, [byHand, turnedDown(31, 'export/baeume-1.1.0')], async () => BOT)
        expect(decline).toEqual({
            iid: 31,
            mrUrl: `${WEB}/-/merge_requests/31`,
            closedAt: '2026-10-22T10:00:00Z',
            closedBy: 'spaudanjo',
            reason: { kind: 'given', text: 'Die Datenquelle ist nicht öffentlich.' },
        })
    })
})

describe('the reading of one version, for the wizard and the refusals', () => {
    it('carries the "no" to a package that never got in, and to a removal (S1, S8)', async () => {
        const gitlab = fakeGitLab({
            branches: {
                'export/baeume-1.1.0': [turnedDown(31, 'export/baeume-1.1.0')],
                'remove/baeume-1.0.0': [turnedDown(12, 'remove/baeume-1.0.0', { user_notes_count: 0, closed_by: BOT })],
                'export/baeume-1.0.0': [request(3, 'export/baeume-1.0.0', 'merged', { sha: 'c'.repeat(40) })],
            },
            notes: REASON,
            files: { [`${'f'.repeat(40)}|packages/baeume/core-ir/manifest.json`]: JSON.stringify({ id: 'urn:stadt:usecase:baeume', version: '1.0.0' }) },
        })
        const turnedDownPackage = await inspectBundle(gitlab.client, TARGET, 'baeume', '1.1.0')
        expect(turnedDownPackage.status).toMatchObject({
            state: 'none',
            reason: 'other-version',
            mrUrl: `${WEB}/-/merge_requests/31`,
            declined: { iid: 31, closedBy: 'spaudanjo', reason: { kind: 'given', text: 'Die Datenquelle ist nicht öffentlich.' } },
        })
        // Accepted and on the base branch: its removal was turned down, through the marketplace's account, the package stays.
        const removal = (await inspectBundle(gitlab.client, TARGET, 'baeume', '1.0.0')).status
        expect(removal.state).toBe('on-base')
        expect(removal.declined).toBeUndefined()
        expect(removal.removal).toEqual({
            state: 'closed',
            mrUrl: `${WEB}/-/merge_requests/12`,
            declined: { iid: 12, mrUrl: `${WEB}/-/merge_requests/12`, closedAt: '2026-10-22T10:00:00Z', closedBy: 'walkable.cities.2021', viaMarketplace: true, reason: { kind: 'none' } },
        })
    })

    it('reads the version even where the comments on a "no" cannot be read: told with that reason, or failing only where a refusal asks (U4)', async () => {
        const branches = {
            'export/baeume-1.1.0': [turnedDown(31, 'export/baeume-1.1.0', { closed_by: BOT })],
            'remove/baeume-1.0.0': [turnedDown(12, 'remove/baeume-1.0.0', { closed_by: BOT })],
            'export/baeume-1.0.0': [request(3, 'export/baeume-1.0.0', 'merged', { sha: 'c'.repeat(40), created_at: '2026-10-01T10:00:00Z' })],
        }
        const files = { [`${'f'.repeat(40)}|packages/baeume/core-ir/manifest.json`]: JSON.stringify({ id: 'urn:stadt:usecase:baeume', version: '1.0.0' }) }
        const gitlab = fakeGitLab({ branches, files, failing: '/notes' })
        // A removal is never withdrawn from here: its "no" stands, and the rest of the reading with it.
        const accepted = (await inspectBundle(gitlab.client, TARGET, 'baeume', '1.0.0')).status
        expect(accepted).toMatchObject({ state: 'on-base', removal: { state: 'closed', declined: { iid: 12, viaMarketplace: true, reason: { kind: 'unreadable' } } } })
        // The package's "no" through the account may be a withdrawal of the time before the mark: the page is told, a refusal fails.
        expect((await inspectBundle(gitlab.client, TARGET, 'baeume', '1.1.0')).status).toMatchObject({ declined: { iid: 31, reason: { kind: 'unreadable' } } })
        await expect(inspectBundle(gitlab.client, TARGET, 'baeume', '1.1.0', undefined, { unreadable: 'throw' })).rejects.toMatchObject({ status: 500 })
    })

    it('carries the "no" to an entry, after what the index says, and leaves a reopened one waiting (U3, S11)', async () => {
        const index = (useCases: unknown[]) => ({ 'main|index.json': JSON.stringify({ version: '1.0.0', useCases }) })
        const entries = { 'catalog/baeume-1.1.0': [turnedDown(31, 'catalog/baeume-1.1.0')] }
        const catalogue = { url: WEB, baseBranch: 'main' }

        const declined = await inspectCatalog(fakeGitLab({ branches: entries, notes: REASON, files: index([]) }).client, catalogue, 'baeume', '1.1.0', 'urn:stadt:usecase:baeume')
        expect(declined.status).toMatchObject({ state: 'declined', mrUrl: `${WEB}/-/merge_requests/31`, declined: { iid: 31, reason: { kind: 'given' } } })

        // The catalogue team listed it after all, by hand: listed wins.
        const listed = await inspectCatalog(
            fakeGitLab({ branches: entries, notes: REASON, files: index([{ id: 'urn:stadt:usecase:baeume', version: '1.1.0' }]) }).client,
            catalogue,
            'baeume',
            '1.1.0',
            'urn:stadt:usecase:baeume',
        )
        expect(listed.status).toEqual({ state: 'listed' })

        // Another publisher's package of the same name proposed on the branch: not this package's "no".
        const foreign = { 'catalog/baeume-1.1.0': [turnedDown(31, 'catalog/baeume-1.1.0', { description: 'Adds `urn:andere:usecase:baeume` in `useCases`' })] }
        expect((await inspectCatalog(fakeGitLab({ branches: foreign, files: index([]) }).client, catalogue, 'baeume', '1.1.0', 'urn:stadt:usecase:baeume')).status).toEqual({ state: 'none' })

        const reopened = { 'catalog/baeume-1.1.0': [request(31, 'catalog/baeume-1.1.0', 'opened')] }
        expect((await inspectCatalog(fakeGitLab({ branches: reopened, files: index([]) }).client, catalogue, 'baeume', '1.1.0', 'urn:stadt:usecase:baeume')).status).toMatchObject({
            state: 'mr-open',
        })
    })
})
