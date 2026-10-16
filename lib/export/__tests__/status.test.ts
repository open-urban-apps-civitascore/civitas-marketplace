import { describe, expect, it } from 'vitest'

import type { MergeRequestRef } from '@/lib/export/gitlab'
import { catalogStatusIn, judgeBundle, packageFolder } from '@/lib/export/status'

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

describe('packageFolder', () => {
    it('names the folder all packages share and the package inside it', () => {
        expect(packageFolder({ pathPrefix: 'packages' }, 'baeume')).toEqual({ parent: 'packages', name: 'baeume' })
        expect(packageFolder({ pathPrefix: '.' }, 'baeume')).toEqual({ parent: '', name: 'baeume' })
    })
})
