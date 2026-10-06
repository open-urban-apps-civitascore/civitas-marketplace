import { describe, expect, it } from 'vitest'

import { DATAPOOL_NAME_MAX, suggestDatapoolName } from '@/lib/datapool-name'

describe('suggestDatapoolName', () => {
    it('names the use case and its version', () => {
        expect(suggestDatapoolName('Verkehrszählung', '0.3.0', [])).toBe('Verkehrszählung v0.3.0')
    })

    it('does not double a leading v', () => {
        expect(suggestDatapoolName('Verkehrszählung', 'v0.3.0', [])).toBe('Verkehrszählung v0.3.0')
    })

    it('counts on past names visible pools already carry, ignoring case', () => {
        const taken = ['verkehrszählung v0.3.0', 'Verkehrszählung v0.3.0 (2)']
        expect(suggestDatapoolName('Verkehrszählung', '0.3.0', taken)).toBe('Verkehrszählung v0.3.0 (3)')
    })

    it('stays within the platform bounds', () => {
        expect(suggestDatapoolName('A'.repeat(400), '1.0.0', []).length).toBeLessThanOrEqual(DATAPOOL_NAME_MAX)
        expect(suggestDatapoolName('', '', [])).toBe('Datenpool')
    })
})
