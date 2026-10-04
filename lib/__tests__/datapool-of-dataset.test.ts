import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchDatapoolOfDataset } from '@/lib/datapool-of-dataset'

function datasetResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200 })
}

function stubFetch(response: Response) {
    const fetchMock = vi.fn().mockResolvedValueOnce(response)
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('fetchDatapoolOfDataset', () => {
    it('reads the pool of the dataset with the token of the caller', async () => {
        const fetchMock = stubFetch(
            datasetResponse({ id: 'ds', datapool: { id: 'pool-1', name: 'Umwelt' } }),
        )

        const pool = await fetchDatapoolOfDataset('ds', 'token-of-the-user')

        expect(pool).toEqual({ id: 'pool-1', name: 'Umwelt' })
        expect(fetchMock.mock.calls[0][0]).toContain('/v1/datasets/ds')
        expect(fetchMock.mock.calls[0][1].headers).toEqual({
            Authorization: 'Bearer token-of-the-user',
        })
    })

    it('is null for a dataset that is in no pool', async () => {
        stubFetch(datasetResponse({ id: 'ds', datapool: null }))

        expect(await fetchDatapoolOfDataset('ds', 'token')).toBeNull()
    })

    it('is null when the dataset cannot be read', async () => {
        stubFetch(new Response('permission_denied', { status: 403 }))

        expect(await fetchDatapoolOfDataset('ds', 'token')).toBeNull()
    })

    it('names the pool by its id when it has no name', async () => {
        stubFetch(datasetResponse({ id: 'ds', datapool: { id: 'pool-1' } }))

        expect(await fetchDatapoolOfDataset('ds', 'token')).toEqual({ id: 'pool-1', name: 'pool-1' })
    })
})
