import { describe, expect, it } from 'vitest'

import { isSafeDatasetId } from '@/lib/export/portal-reader'

/**
 * A dataset id is interpolated into the portal's REST paths, so the rule is
 * asserted directly rather than through `readUseCase`: going via the fetch made
 * the "accepted" cases depend on API_BASE_URL being unset under vitest, which is
 * a test that passes for the wrong reason.
 */
describe('isSafeDatasetId', () => {
    it('refuses the dot segments a URL parser folds away', () => {
        // `/v1/datasets/../pipelines` resolves to `/v1/pipelines`, which is why a
        // leading dot cannot be allowed — the earlier rule admitted exactly this.
        expect(new URL('http://h/v1/datasets/../pipelines').pathname).toBe('/v1/pipelines')
        for (const id of ['.', '..', '....', '../admin', './x']) {
            expect(isSafeDatasetId(id), id).toBe(false)
        }
    })

    it('refuses anything that could leave the segment', () => {
        for (const id of ['a/b', 'a\\b', 'a?b', 'a#b', 'a b', '', 'ä', '-lead']) {
            expect(isSafeDatasetId(id), JSON.stringify(id)).toBe(false)
        }
    })

    it('allows the shapes a portal actually issues', () => {
        // Dots inside the id are harmless: it is one segment and cannot hold a slash.
        for (const id of ['a..b', 'urn:core:dataset:x', '3f2b9c1a-0e4d-4a11-9d2e-7b6c5a4f3e21', 'v1.2']) {
            expect(isSafeDatasetId(id), id).toBe(true)
        }
    })

    it('stops at 200 characters', () => {
        expect(isSafeDatasetId('a'.repeat(200))).toBe(true)
        expect(isSafeDatasetId('a'.repeat(201))).toBe(false)
    })
})
