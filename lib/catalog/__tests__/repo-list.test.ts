import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    getRepoListMeta,
    getRepoListSummaries,
    parseRepoListIndex,
    resetRepoListCacheForTests,
} from '@/lib/catalog/repo-list'

const VALID_INDEX = {
    version: '2.0.0',
    updatedAt: '2026-08-21T12:00:00Z',
    addons: [],
    useCases: [
        {
            id: 'urn:openurbanapps:usecase:verkehrszaehlung',
            type: 'usecase',
            displayName: 'Verkehrszählung',
            description: 'Test',
            version: '1.2.0',
            maintainer: 'Open Urban Apps',
            license: 'EUPL-1.2',
            keywords: ['verkehr'],
            source: { repoUrl: 'https://gitlab.example/repo', gitIdentifier: 'v2.0.0' },
        },
    ],
    dataStructures: [],
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

beforeEach(() => {
    resetRepoListCacheForTests()
    vi.stubEnv('REPO_LIST_URL', 'https://gitlab.example/index.json')
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe('repo-list', () => {
    it('serves an honest empty catalogue when no URL is configured', async () => {
        vi.stubEnv('REPO_LIST_URL', '')
        const meta = await getRepoListMeta()
        expect(meta.origin).toBe('unconfigured')
        expect(meta.stale).toBe(true)
        expect(await getRepoListSummaries('usecase')).toEqual([])
    })

    it('fetches, validates and caches the remote index', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(VALID_INDEX))
        vi.stubGlobal('fetch', fetchMock)

        const meta = await getRepoListMeta()
        expect(meta).toMatchObject({ origin: 'remote', stale: false, version: '2.0.0' })
        expect(await getRepoListSummaries('usecase')).toHaveLength(1)

        // Second call within the TTL: served from cache, no second fetch.
        await getRepoListSummaries('usecase')
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('keeps serving last-known-good (flagged stale) when the remote breaks', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse(VALID_INDEX))
            .mockRejectedValue(new Error('network down'))
        vi.stubGlobal('fetch', fetchMock)

        vi.useFakeTimers()
        await getRepoListMeta()
        // Jump past the TTL: the next call re-fetches — and fails.
        vi.advanceTimersByTime(901_000)
        const meta = await getRepoListMeta()
        vi.useRealTimers()
        expect(meta.origin).toBe('remote')
        expect(meta.stale).toBe(true)
        // Content survives: the last valid state is still served.
        expect(await getRepoListSummaries('usecase')).toHaveLength(1)
    })

    it('serves an empty catalogue on a cold start with an unreachable remote', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('refused')))
        const meta = await getRepoListMeta()
        expect(meta.origin).toBe('unreachable')
        expect(meta.stale).toBe(true)
        expect(await getRepoListSummaries('datastructure')).toEqual([])
    })

    it('treats a malformed index as a failed fetch (whole-index fallback)', async () => {
        const broken = structuredClone(VALID_INDEX) as Record<string, unknown>
        ;(broken.useCases as Record<string, unknown>[])[0].source = undefined
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(broken)))
        const meta = await getRepoListMeta()
        expect(meta.origin).toBe('unreachable')
    })
})

describe('parseRepoListIndex', () => {
    it('accepts a valid index and defaults missing sections to empty arrays', () => {
        const parsed = parseRepoListIndex({ version: '1.0.0', updatedAt: 'now' })
        expect(parsed.addons).toEqual([])
        expect(parsed.useCases).toEqual([])
        expect(parsed.dataStructures).toEqual([])
    })

    it('refuses rows without a source pointer', () => {
        expect(() =>
            parseRepoListIndex({
                version: '1.0.0',
                updatedAt: 'now',
                useCases: [{ ...VALID_INDEX.useCases[0], source: undefined }],
            }),
        ).toThrow(/source/)
    })
})
