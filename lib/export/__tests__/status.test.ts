import { describe, expect, it } from 'vitest'

import type { MergeRequestRef } from '@/lib/export/gitlab'
import { judgeBundle } from '@/lib/export/status'

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
