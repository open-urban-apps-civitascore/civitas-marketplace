import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseCatalogAddon } from '@/lib/addon-catalog/listing'
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

    it('normalises a legacy source row: the tag pin doubles as the release name', () => {
        const parsed = parseRepoListIndex(VALID_INDEX)
        expect(parsed.useCases[0].deploymentRef).toEqual({
            url: 'https://gitlab.example/repo',
            ref: 'v2.0.0',
            releaseTag: 'v2.0.0',
            path: '.',
        })
        expect('source' in parsed.useCases[0]).toBe(false)
    })

    it('normalises a legacy source row pinned by commit hash: no release name', () => {
        const sha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4'
        const parsed = parseRepoListIndex({
            ...VALID_INDEX,
            useCases: [
                {
                    ...VALID_INDEX.useCases[0],
                    source: { repoUrl: 'https://gitlab.example/repo', gitIdentifier: sha },
                },
            ],
        })
        expect(parsed.useCases[0].deploymentRef).toEqual({
            url: 'https://gitlab.example/repo',
            ref: sha,
            releaseTag: null,
            path: '.',
        })
    })

    it('accepts the deploymentRef row shape and defaults its optional fields', () => {
        const sha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4'
        const parsed = parseRepoListIndex({
            ...VALID_INDEX,
            useCases: [
                {
                    ...VALID_INDEX.useCases[0],
                    source: undefined,
                    deploymentRef: { url: 'https://gitlab.example/repo', ref: sha },
                },
            ],
        })
        expect(parsed.useCases[0].deploymentRef).toEqual({
            url: 'https://gitlab.example/repo',
            ref: sha,
            releaseTag: null,
            path: '.',
        })
    })

    it('prefers deploymentRef when a row carries both shapes', () => {
        const sha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4'
        const parsed = parseRepoListIndex({
            ...VALID_INDEX,
            useCases: [
                {
                    ...VALID_INDEX.useCases[0],
                    deploymentRef: {
                        url: 'https://gitlab.example/repo',
                        ref: sha,
                        releaseTag: 'v2.1.0',
                        path: 'usecases/traffic',
                    },
                },
            ],
        })
        expect(parsed.useCases[0].deploymentRef).toEqual({
            url: 'https://gitlab.example/repo',
            ref: sha,
            releaseTag: 'v2.1.0',
            path: 'usecases/traffic',
        })
    })

    it('refuses rows without a source pointer', () => {
        expect(() =>
            parseRepoListIndex({
                version: '1.0.0',
                updatedAt: 'now',
                useCases: [{ ...VALID_INDEX.useCases[0], source: undefined }],
            }),
        ).toThrow(/deploymentRef/)
    })

    it('treats deploymentRef: null like an absent field and falls back to legacy source', () => {
        const parsed = parseRepoListIndex({
            ...VALID_INDEX,
            useCases: [{ ...VALID_INDEX.useCases[0], deploymentRef: null }],
        })
        expect(parsed.useCases[0].deploymentRef).toMatchObject({ ref: 'v2.0.0' })
    })

    it('accepts an explicit releaseTag: null on the wire', () => {
        const sha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4'
        const parsed = parseRepoListIndex({
            ...VALID_INDEX,
            useCases: [
                {
                    ...VALID_INDEX.useCases[0],
                    source: undefined,
                    deploymentRef: { url: 'https://gitlab.example/repo', ref: sha, releaseTag: null },
                },
            ],
        })
        expect(parsed.useCases[0].deploymentRef?.releaseTag).toBeNull()
    })

    it('refuses a new-shape ref that is not a full commit SHA', () => {
        expect(() =>
            parseRepoListIndex({
                ...VALID_INDEX,
                useCases: [
                    {
                        ...VALID_INDEX.useCases[0],
                        source: undefined,
                        deploymentRef: { url: 'https://gitlab.example/repo', ref: 'v2.1.0' },
                    },
                ],
            }),
        ).toThrow(/40-hex commit SHA/)
    })

    it('refuses a legacy pin that names a branch', () => {
        expect(() =>
            parseRepoListIndex({
                ...VALID_INDEX,
                useCases: [
                    {
                        ...VALID_INDEX.useCases[0],
                        source: { repoUrl: 'https://gitlab.example/repo', gitIdentifier: 'main' },
                    },
                ],
            }),
        ).toThrow(/branch/)
    })

    it('refuses a package path that could traverse out of the pinned URL segment', () => {
        const sha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4'
        expect(() =>
            parseRepoListIndex({
                ...VALID_INDEX,
                useCases: [
                    {
                        ...VALID_INDEX.useCases[0],
                        source: undefined,
                        deploymentRef: {
                            url: 'https://gitlab.example/repo',
                            ref: sha,
                            path: '../main',
                        },
                    },
                ],
            }),
        ).toThrow(/plain relative path/)
    })

    it('parses an index shaped like the published v2.6.0 and yields the expected per-row outcomes', () => {
        // Mirrors the live catalogue's mix: a commit-pinned addon, a
        // tag-pinned addon with curated resolvedCommit, an unpinned listing,
        // and legacy-source useCases/dataStructures. Guards against a future
        // strictness change quietly rejecting the whole published index.
        const shaA = '7c0830c53952c6444e8f2332c1b48826489ffd79'
        const shaB = '9bef74ce374647c776e0249337a4af111bc7cd3b'
        const liveLike = {
            version: '2.6.0',
            updatedAt: '2026-08-27T00:00:00Z',
            addons: [
                {
                    id: 'geoportal',
                    name: 'Geoportal',
                    description: 'Kartenportal',
                    author: 'Civitas Connect e. V.',
                    categories: ['Karte'],
                    compatibility: [{ coreVersion: '2.0' }],
                    deploymentRef: {
                        type: 'git',
                        url: 'https://gitlab.com/group/geoportal/deployment',
                        path: '.',
                        ref: shaA,
                        refType: 'commit',
                        resolvedCommit: shaA,
                    },
                    install: { componentName: 'geoportal', subdomain: 'geoportal' },
                    curation: { tier: 'community', reviewedBy: 'OUA', reviewedAt: '2026-08-10' },
                },
                {
                    id: 'grafana',
                    name: 'Grafana',
                    description: 'Dashboards',
                    author: 'Civitas Connect e. V.',
                    categories: ['Dashboard'],
                    compatibility: [{ coreVersion: '2.0' }],
                    deploymentRef: {
                        type: 'git',
                        url: 'https://gitlab.com/group/grafana',
                        path: '.',
                        ref: 'v2.0-rc',
                        refType: 'tag',
                        resolvedCommit: shaB,
                    },
                    install: { componentName: 'grafana', subdomain: 'grafana' },
                    curation: { tier: 'verified', reviewedBy: 'OUA', reviewedAt: '2026-08-10' },
                },
                {
                    id: 'nodered-addon',
                    name: 'NodeRed',
                    description: 'Flow-based programming',
                    author: 'bonn-624-dev',
                    categories: ['IoT'],
                    compatibility: [{ coreVersion: '2.0', branch: 'main' }],
                    deploymentRef: {
                        type: 'git',
                        url: 'https://gitlab.com/bonn/nodered_addon',
                        path: 'addons/nodered_addon',
                    },
                },
            ],
            useCases: VALID_INDEX.useCases,
            dataStructures: [
                {
                    id: 'urn:core:standard:openurbanapps:datastructure:umwelt:baumkataster:x1',
                    type: 'datastructure',
                    displayName: 'Baumkataster',
                    description: 'Datenmodell',
                    version: '1.0.0',
                    maintainer: 'Open Urban Apps',
                    license: 'EUPL-1.2',
                    keywords: ['umwelt'],
                    source: { repoUrl: 'https://gitlab.example/repo', gitIdentifier: 'v2.0.0' },
                },
            ],
        }

        const parsed = parseRepoListIndex(liveLike)
        expect(parsed.addons).toHaveLength(3)
        expect(parsed.useCases[0].deploymentRef?.ref).toBe('v2.0.0')
        expect(parsed.dataStructures[0].deploymentRef?.releaseTag).toBe('v2.0.0')

        const [geoportal, grafana, nodered] = parsed.addons.map((row) => parseCatalogAddon(row)!)
        expect(geoportal.listing.install?.source).toMatchObject({ ref: shaA, releaseTag: null })
        // The curated resolvedCommit is the pin; the tag stays the label.
        expect(grafana.listing.install?.source).toMatchObject({ ref: shaB, releaseTag: 'v2.0-rc' })
        expect(nodered.listing.install).toBeUndefined()
        expect(nodered.missingForInstall.join(' ')).toMatch(/Feste Version/)
    })

    it('refuses a deploymentRef without a ref', () => {
        expect(() =>
            parseRepoListIndex({
                version: '1.0.0',
                updatedAt: 'now',
                useCases: [
                    {
                        ...VALID_INDEX.useCases[0],
                        source: undefined,
                        deploymentRef: { url: 'https://gitlab.example/repo' },
                    },
                ],
            }),
        ).toThrow(/ref/)
    })
})
