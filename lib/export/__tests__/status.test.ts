import { describe, expect, it } from 'vitest'

import type { MergeRequestRef } from '@/lib/export/gitlab'
import { catalogFloor, catalogStatusIn, judgeBundle, packageFolder } from '@/lib/export/status'

const merged: MergeRequestRef = {
    iid: 3,
    web_url: 'https://gitlab.example/group/packages/-/merge_requests/3',
    state: 'merged',
    source_branch: 'export/baeume-1.0.0',
    sha: 'm1',
}

describe('judgeBundle', () => {
    it('verifies a package whose directory on the base branch is the merged one', () => {
        expect(judgeBundle(merged, { onBase: 't1', merged: 't1', exported: 't1' })).toEqual({
            state: 'verified',
            mergedMrUrl: merged.web_url,
            changedInReview: false,
        })
    })

    it('notes a review that changed the package, without refusing it', () => {
        const verdict = judgeBundle(merged, { onBase: 't2', merged: 't2', exported: 't1' })
        expect(verdict.state).toBe('verified')
        expect(verdict.changedInReview).toBe(true)
    })

    it('refuses a package changed after the merge', () => {
        expect(judgeBundle(merged, { onBase: 't3', merged: 't2', exported: 't2' }).state).toBe('changed-after-merge')
    })

    it('has nothing to compare with when no export was merged', () => {
        expect(judgeBundle(undefined, { onBase: 't1' })).toEqual({ state: 'no-merge-request' })
    })

    it('says so when the merged state cannot be read', () => {
        expect(judgeBundle(merged, { onBase: 't1' }).state).toBe('unverifiable')
    })
})

describe('catalogStatusIn', () => {
    const index = JSON.stringify({ version: '1.0.0', useCases: [{ id: 'urn:stadt:usecase:baeume', version: '1.0.0' }] })
    const open = (branch: string): MergeRequestRef => ({ iid: 9, state: 'opened', source_branch: branch, web_url: `https://gitlab.example/mr/${branch}` })

    it('finds the open catalogue request of this version among all open requests', () => {
        const context = { openRequests: [open('catalog/pegel-1.0.0'), open('catalog/baeume-1.1.0')], index }
        expect(catalogStatusIn(context, 'baeume', '1.1.0', 'urn:stadt:usecase:baeume')).toEqual({
            state: 'mr-open',
            mrUrl: 'https://gitlab.example/mr/catalog/baeume-1.1.0',
        })
    })

    it('reads a listed version from the index, and nothing else as listed', () => {
        expect(catalogStatusIn({ openRequests: [], index }, 'baeume', '1.0.0', 'urn:stadt:usecase:baeume').state).toBe('listed')
        expect(catalogStatusIn({ openRequests: [], index }, 'baeume', '1.1.0', 'urn:stadt:usecase:baeume').state).toBe('none')
        expect(catalogStatusIn({ openRequests: [], index: undefined }, 'baeume', '1.0.0', 'urn:stadt:usecase:baeume').state).toBe('none')
    })
})

describe('a version the catalogue team took out', () => {
    const ID = 'urn:stadt:usecase:baeume'
    const indexOf = (useCases: unknown[]) => JSON.stringify({ version: '1.0.0', useCases })
    /** A merged catalogue proposal as `proposeCatalog` writes it: the branch names slug and version, the description the id. */
    const merged = (iid: number, version: string, id = ID): MergeRequestRef => ({
        iid,
        state: 'merged',
        source_branch: `catalog/baeume-${version}`,
        web_url: `https://gitlab.example/mr/${iid}`,
        description: `Proposed by the Open Urban Apps marketplace on behalf of **Ewa**.\n\nAdds \`${id}\` in \`useCases\`, pinned to ...`,
    })
    const open = (version: string): MergeRequestRef => ({ iid: 27, state: 'opened', source_branch: `catalog/baeume-${version}`, web_url: 'https://gitlab.example/mr/27' })

    it('is withdrawn when it was listed once and its row was deleted by hand', () => {
        const context = { openRequests: [], index: indexOf([]), merged: [merged(5, '1.0.2')] }
        expect(catalogStatusIn(context, 'baeume', '1.0.2', ID)).toEqual({ state: 'withdrawn', takenOut: { version: '1.0.2' } })
        // Another version may still go in, and knows what happened to the earlier one.
        expect(catalogStatusIn(context, 'baeume', '1.1.0', ID)).toEqual({ state: 'none', takenOut: { version: '1.0.2' } })
    })

    it('is withdrawn, with the reason, when its row is marked revoked - and so is the whole entry', () => {
        const context = { openRequests: [], index: indexOf([{ id: ID, version: '1.0.2', revoked: true, revokedReason: 'Datenquelle abgeschaltet' }]), merged: [] }
        const status = catalogStatusIn(context, 'baeume', '1.0.2', ID)
        expect(status).toEqual({ state: 'withdrawn', takenOut: { version: '1.0.2', reason: 'Datenquelle abgeschaltet' } })
        expect(catalogStatusIn(context, 'baeume', '1.1.0', ID)).toMatchObject({ state: 'withdrawn', takenOut: { version: '1.0.2' } })
    })

    it('flags an open proposal that would bring a taken-out version back', () => {
        const context = { openRequests: [open('1.0.2')], index: indexOf([]), merged: [merged(5, '1.0.2')] }
        expect(catalogStatusIn(context, 'baeume', '1.0.2', ID)).toEqual({
            state: 'mr-open',
            mrUrl: 'https://gitlab.example/mr/27',
            takenOut: { version: '1.0.2' },
            bringsBack: true,
        })
        // A first proposal of a version is no such thing.
        expect(catalogStatusIn({ ...context, merged: [] }, 'baeume', '1.0.2', ID)).toEqual({ state: 'mr-open', mrUrl: 'https://gitlab.example/mr/27' })
    })

    it('calls a version replaced by a newer listed one replaced, not taken out', () => {
        const context = { openRequests: [], index: indexOf([{ id: ID, version: '1.1.0' }]), merged: [merged(5, '1.0.2'), merged(6, '1.1.0')] }
        expect(catalogStatusIn(context, 'baeume', '1.0.2', ID)).toEqual({ state: 'none' })
        expect(catalogStatusIn(context, 'baeume', '1.1.0', ID)).toEqual({ state: 'listed' })
    })

    it('counts only proposals that name this package, and judges nothing without an index', () => {
        // The branch names no publisher: another publisher's "baeume" is not this one.
        const foreign = { openRequests: [], index: indexOf([]), merged: [merged(5, '1.0.2', 'urn:andere:usecase:baeume')] }
        expect(catalogStatusIn(foreign, 'baeume', '1.0.2', ID)).toEqual({ state: 'none' })
        for (const index of [undefined, '{not json']) {
            expect(catalogStatusIn({ openRequests: [], index, merged: [merged(5, '1.0.2')] }, 'baeume', '1.0.2', ID)).toEqual({ state: 'none' })
        }
    })

    it('knows the highest version that reached the catalogue, listed or taken out', () => {
        expect(catalogFloor({ openRequests: [], index: indexOf([{ id: ID, version: '1.1.0' }]) }, ID)).toBe('1.1.0')
        expect(catalogFloor({ openRequests: [], index: indexOf([{ id: ID, version: '1.0.0', revoked: true }]) }, ID)).toBe('1.0.0')
        expect(catalogFloor({ openRequests: [], index: indexOf([{ id: ID, version: '1.0.0' }]), merged: [merged(5, '1.2.0')] }, ID)).toBe('1.2.0')
        expect(catalogFloor({ openRequests: [], index: indexOf([]) }, ID)).toBeUndefined()
        expect(catalogFloor({ openRequests: [], index: undefined, merged: [merged(5, '1.2.0')] }, ID)).toBeUndefined()
    })
})

describe('a "no" to the entry, in the catalogue’s order (U3 of 2026-10-22)', () => {
    const ID = 'urn:stadt:usecase:baeume'
    const indexOf = (useCases: unknown[]) => JSON.stringify({ version: '1.0.0', useCases })
    const declined = { iid: 32, mrUrl: 'https://gitlab.example/mr/32', closedAt: '2026-10-22T09:41:28Z', viaMarketplace: true, reason: { kind: 'none' as const } }
    const merged = (iid: number, version: string): MergeRequestRef => ({
        iid,
        state: 'merged',
        source_branch: `catalog/baeume-${version}`,
        web_url: `https://gitlab.example/mr/${iid}`,
        description: `Adds \`${ID}\` in \`useCases\`, pinned to ...`,
    })

    it('is told after open, listed and taken out, and before none', () => {
        const none = { openRequests: [], index: indexOf([]), merged: [] }
        expect(catalogStatusIn(none, 'baeume', '1.1.4', ID, declined)).toEqual({ state: 'declined', mrUrl: declined.mrUrl, declined })
        expect(catalogStatusIn(none, 'baeume', '1.1.4', ID)).toEqual({ state: 'none' })
        // Reopened: open again, the "no" is history (S11).
        const open = { ...none, openRequests: [{ iid: 32, state: 'opened', source_branch: 'catalog/baeume-1.1.4', web_url: declined.mrUrl }] }
        expect(catalogStatusIn(open, 'baeume', '1.1.4', ID, declined).state).toBe('mr-open')
        // Listed by the team after all ("yes, but differently", S12).
        expect(catalogStatusIn({ ...none, index: indexOf([{ id: ID, version: '1.1.4' }]) }, 'baeume', '1.1.4', ID, declined)).toEqual({ state: 'listed' })
        // Closed proposals that would have brought back what the team took out stay taken out (!27, !29, !30).
        expect(catalogStatusIn({ ...none, merged: [merged(5, '1.1.4')] }, 'baeume', '1.1.4', ID, declined)).toEqual({ state: 'withdrawn', takenOut: { version: '1.1.4' } })
    })

    it('keeps what the team took out of another version beside it', () => {
        const context = { openRequests: [], index: indexOf([]), merged: [merged(5, '1.0.2')] }
        expect(catalogStatusIn(context, 'baeume', '1.1.4', ID, declined)).toEqual({ state: 'declined', mrUrl: declined.mrUrl, declined, takenOut: { version: '1.0.2' } })
    })
})

describe('packageFolder', () => {
    it('names the folder all packages share and the package inside it', () => {
        expect(packageFolder({ pathPrefix: 'packages' }, 'baeume')).toEqual({ parent: 'packages', name: 'baeume' })
        expect(packageFolder({ pathPrefix: '.' }, 'baeume')).toEqual({ parent: '', name: 'baeume' })
    })
})
