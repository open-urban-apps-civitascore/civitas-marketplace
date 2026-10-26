import { describe, expect, it } from 'vitest'

import { resultTone } from '@/lib/export/result-tone'

describe('resultTone', () => {
    it('shows good news as success, never as a warning', () => {
        expect(resultTone('ok')).toBe('success')
        expect(resultTone('unchanged')).toBe('success')
    })

    it('keeps facts and other people’s tasks neutral', () => {
        expect(resultTone('already-open')).toBe('neutral')
        expect(resultTone('not-merged')).toBe('neutral')
        expect(resultTone('unconfigured')).toBe('neutral')
        expect(resultTone('forbidden')).toBe('neutral')
        // A "no" of the catalogue team that „Stand prüfen“ found is news to read, not good news.
        expect(resultTone('declined')).toBe('neutral')
    })

    it('marks a failed or refused action as an error', () => {
        expect(resultTone('invalid')).toBe('error')
        expect(resultTone('error')).toBe('error')
    })
})
