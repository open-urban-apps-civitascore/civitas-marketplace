import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FIXTURE_PIN, getCatalogSummaries, getCatalogSummary } from '@/lib/catalog/source'
import { buildUseCaseListing } from '@/lib/use-case-catalog/listing'

beforeEach(() => {
    vi.stubEnv('MOCK_CATALOG', '1')
})

afterEach(() => {
    vi.unstubAllEnvs()
})

describe('the catalogue from the bundled fixtures', () => {
    it('offers every use case for install', async () => {
        const summaries = await getCatalogSummaries('usecase')

        expect(summaries.length).toBeGreaterThan(0)
        for (const summary of summaries) {
            expect(summary.deploymentRef).toEqual(FIXTURE_PIN)
            expect(buildUseCaseListing(summary).state).toBe('installable')
        }
    })

    it('gives a single entry the same pin as the list', async () => {
        const [first] = await getCatalogSummaries('usecase')

        expect((await getCatalogSummary(first.id))?.deploymentRef).toEqual(FIXTURE_PIN)
    })
})
