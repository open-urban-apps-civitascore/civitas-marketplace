import { describe, expect, it } from 'vitest'

import type { ExportActionResult } from '@/lib/export-actions'
import { mergeRequestRef, mergeShareResult, rememberShareResult, shareKey } from '@/lib/export/share-state'

const MR = 'https://gitlab.com/group/repo/-/merge_requests/18'
const CATALOG_MR = 'https://gitlab.com/group/catalog/-/merge_requests/19'
const version = (v: string) => shareKey({ targetKey: 'catalog', publisher: 'openurbanapps', slug: 'verkehrszaehlung', version: v })
const result = (partial: Partial<ExportActionResult> & Pick<ExportActionResult, 'intent' | 'status'>): ExportActionResult => ({
    detail: '',
    ...partial,
})

describe('share state', () => {
    it('remembers a merge request the bundle step opened', () => {
        expect(mergeShareResult({}, result({ intent: 'bundle', status: 'ok', mrUrl: MR })).bundle).toEqual({ state: 'mr-open', mrUrl: MR })
    })

    it('counts an already open merge request as proposed too', () => {
        expect(mergeShareResult({}, result({ intent: 'bundle', status: 'already-open', mrUrl: MR })).bundle?.state).toBe('mr-open')
    })

    it('keeps what is known when a later result carries nothing about it', () => {
        const proposed = mergeShareResult({}, result({ intent: 'bundle', status: 'ok', mrUrl: MR }))
        expect(mergeShareResult(proposed, result({ intent: 'status', status: 'error' })).bundle).toEqual({ state: 'mr-open', mrUrl: MR })
        expect(mergeShareResult(proposed, result({ intent: 'preview', status: 'ok' })).bundle).toEqual({ state: 'mr-open', mrUrl: MR })
    })

    it("lets the server's reading replace what was assumed", () => {
        const proposed = mergeShareResult({}, result({ intent: 'bundle', status: 'ok', mrUrl: MR }))
        const merged = mergeShareResult(
            proposed,
            result({
                intent: 'status',
                status: 'ok',
                bundle: { state: 'on-base', verification: { state: 'verified' } },
                catalog: { state: 'none' },
            }),
        )
        expect(merged.bundle?.state).toBe('on-base')
        expect(merged.catalog).toEqual({ state: 'none' })
    })

    it('records the catalogue step, including an entry that is already listed', () => {
        expect(mergeShareResult({}, result({ intent: 'catalog', status: 'ok', mrUrl: CATALOG_MR })).catalog).toEqual({
            state: 'mr-open',
            mrUrl: CATALOG_MR,
        })
        expect(mergeShareResult({}, result({ intent: 'catalog', status: 'unchanged' })).catalog).toEqual({ state: 'listed' })
    })

    it('does not mark a refused catalogue step as proposed', () => {
        const next = mergeShareResult({}, result({ intent: 'catalog', status: 'invalid', bundle: { state: 'on-base' } }))
        expect(next.catalog).toBeUndefined()
        expect(next.bundle?.state).toBe('on-base')
    })

    it('keeps each version apart, so going back to one does not forget its merge request', () => {
        // Propose 1.7.1, preview 1.7.2, come back to 1.7.1: the review found the button coming back here.
        let states = rememberShareResult({}, version('1.7.1'), result({ intent: 'bundle', status: 'ok', mrUrl: MR }))
        states = rememberShareResult(states, version('1.7.2'), result({ intent: 'preview', status: 'ok' }))
        states = rememberShareResult(states, version('1.7.1'), result({ intent: 'preview', status: 'ok' }))
        expect(states[version('1.7.1')]?.bundle).toEqual({ state: 'mr-open', mrUrl: MR })
        expect(states[version('1.7.2')]?.bundle).toBeUndefined()
    })

    it('ignores case and surrounding spaces in the key, as the server does', () => {
        expect(shareKey({ targetKey: 'catalog', publisher: ' OpenUrbanApps ', slug: 'Verkehrszaehlung', version: '1.7.1 ' })).toBe(version('1.7.1'))
    })

    it('names a merge request by its number', () => {
        expect(mergeRequestRef(MR)).toBe('!18')
        expect(mergeRequestRef('https://gitlab.com/group/repo')).toBeUndefined()
        expect(mergeRequestRef(undefined)).toBeUndefined()
    })
})
