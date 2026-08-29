import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseCatalogAddon } from '@/lib/addon-catalog/listing'
import {
    findRepoListSummary,
    getRepoListAddons,
    getRepoListMeta,
    getRepoListSummaries,
    parseRepoListIndex,
    resetRepoListCacheForTests,
} from '@/lib/catalog/repo-list'

const SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4'

const VALID_INDEX = {
    version: '3.0.0',
    updatedAt: '2026-08-29T00:00:00Z',
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
            deploymentRef: {
                url: 'https://gitlab.example/repo',
                ref: SHA,
                releaseTag: 'v2.0.0',
                path: '.',
            },
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
        expect(meta).toMatchObject({ origin: 'remote', stale: false, version: '3.0.0' })
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

    it('hides revoked rows from every read API', async () => {
        const withTombstones = {
            ...VALID_INDEX,
            addons: [
                {
                    id: 'dead-addon',
                    name: 'Dead',
                    description: 'x',
                    author: 'y',
                    revoked: true,
                    revokedReason: 'withdrawn',
                },
            ],
            useCases: [
                VALID_INDEX.useCases[0],
                {
                    ...VALID_INDEX.useCases[0],
                    id: 'urn:openurbanapps:usecase:tot',
                    revoked: true,
                    revokedReason: 'withdrawn',
                    deploymentRef: undefined,
                },
            ],
        }
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(withTombstones)))

        expect((await getRepoListSummaries('usecase')).map((row) => row.id)).toEqual([
            VALID_INDEX.useCases[0].id,
        ])
        expect(await findRepoListSummary('urn:openurbanapps:usecase:tot')).toBeUndefined()
        expect(await findRepoListSummary(VALID_INDEX.useCases[0].id)).toBeDefined()
        expect(await getRepoListAddons()).toEqual([])
    })

    it('treats a malformed index as a failed fetch (whole-index fallback)', async () => {
        const broken = structuredClone(VALID_INDEX) as Record<string, unknown>
        ;(broken.useCases as Record<string, unknown>[])[0].deploymentRef = undefined
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(broken)))
        const meta = await getRepoListMeta()
        expect(meta.origin).toBe('unreachable')
    })
})

function indexWithUseCase(overrides: Record<string, unknown>) {
    return {
        ...VALID_INDEX,
        useCases: [{ ...VALID_INDEX.useCases[0], ...overrides }],
    }
}

describe('parseRepoListIndex', () => {
    it('accepts a valid index and defaults missing sections to empty arrays', () => {
        const parsed = parseRepoListIndex({ version: '1.0.0', updatedAt: 'now' })
        expect(parsed.addons).toEqual([])
        expect(parsed.useCases).toEqual([])
        expect(parsed.dataStructures).toEqual([])
    })

    it('accepts the v3 row shape and defaults its optional fields', () => {
        const parsed = parseRepoListIndex(
            indexWithUseCase({ deploymentRef: { url: 'https://gitlab.example/repo', ref: SHA } }),
        )
        expect(parsed.useCases[0].deploymentRef).toEqual({
            url: 'https://gitlab.example/repo',
            ref: SHA,
            releaseTag: null,
            path: '.',
        })
    })

    it('ignores a stray legacy source key beside a valid deploymentRef', () => {
        const parsed = parseRepoListIndex(
            indexWithUseCase({ source: { repoUrl: 'https://old', gitIdentifier: 'v1' } }),
        )
        expect(parsed.useCases[0].deploymentRef?.ref).toBe(SHA)
        expect('source' in parsed.useCases[0]).toBe(false)
    })

    it('refuses a legacy source-only row — the migrated catalogue no longer publishes them', () => {
        expect(() =>
            parseRepoListIndex(
                indexWithUseCase({
                    deploymentRef: undefined,
                    source: { repoUrl: 'https://gitlab.example/repo', gitIdentifier: 'v2.0.0' },
                }),
            ),
        ).toThrow(/deploymentRef/)
    })

    it('accepts an explicit releaseTag: null on the wire', () => {
        const parsed = parseRepoListIndex(
            indexWithUseCase({
                deploymentRef: { url: 'https://gitlab.example/repo', ref: SHA, releaseTag: null },
            }),
        )
        expect(parsed.useCases[0].deploymentRef?.releaseTag).toBeNull()
    })

    it('refuses a ref that is not a full commit SHA', () => {
        expect(() =>
            parseRepoListIndex(
                indexWithUseCase({
                    deploymentRef: { url: 'https://gitlab.example/repo', ref: 'v2.1.0' },
                }),
            ),
        ).toThrow(/40-hex commit SHA/)
    })

    it('treats path: null like an absent path', () => {
        const parsed = parseRepoListIndex(
            indexWithUseCase({
                deploymentRef: { url: 'https://gitlab.example/repo', ref: SHA, path: null },
            }),
        )
        expect(parsed.useCases[0].deploymentRef?.path).toBe('.')
    })

    it('refuses a package path that could traverse out of the pinned URL segment', () => {
        expect(() =>
            parseRepoListIndex(
                indexWithUseCase({
                    deploymentRef: { url: 'https://gitlab.example/repo', ref: SHA, path: '../main' },
                }),
            ),
        ).toThrow(/plain relative path/)
    })

    it('refuses rows without a source pointer', () => {
        expect(() => parseRepoListIndex(indexWithUseCase({ deploymentRef: undefined }))).toThrow(
            /deploymentRef/,
        )
    })

    it('refuses a deploymentRef without a ref', () => {
        expect(() =>
            parseRepoListIndex(
                indexWithUseCase({ deploymentRef: { url: 'https://gitlab.example/repo' } }),
            ),
        ).toThrow(/ref/)
    })

    it('never parses a tombstone pin: any historical shape survives, uninstallable', () => {
        // Exactly the migrated catalogue's Baumkataster case (legacy source) —
        // plus outright garbage, which must be equally harmless: a tombstone
        // can never take the live index down.
        for (const pinData of [
            { source: { repoUrl: 'https://gitlab.example/repo', gitIdentifier: 'v2.0.0' }, deploymentRef: undefined },
            { deploymentRef: { anything: 'goes' } },
            { deploymentRef: undefined },
        ]) {
            const parsed = parseRepoListIndex(
                indexWithUseCase({ ...pinData, revoked: true, revokedReason: 'withdrawn' }),
            )
            expect(parsed.useCases[0].revoked).toBe(true)
            expect(parsed.useCases[0].deploymentRef).toBeUndefined()
        }
    })

    it('parses an index shaped like the published v3 catalogue with the expected outcomes', () => {
        const shaA = '7c0830c53952c6444e8f2332c1b48826489ffd79'
        const shaB = '9bef74ce374647c776e0249337a4af111bc7cd3b'
        const liveLike = {
            version: '3.0.0',
            updatedAt: '2026-08-29T00:00:00Z',
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
                        releaseTag: null,
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
                        ref: shaB,
                        releaseTag: 'v2.0-rc',
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
                    deprecated: { reason: 'Doppelte Listung.', successorId: 'node-red' },
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
                    revoked: true,
                    revokedReason: 'Repository nicht mehr öffentlich.',
                    source: { repoUrl: 'https://gitlab.example/repo', gitIdentifier: 'v2.0.0' },
                },
            ],
        }

        const parsed = parseRepoListIndex(liveLike)
        expect(parsed.addons).toHaveLength(3)
        expect(parsed.useCases[0].deploymentRef?.ref).toBe(SHA)
        expect(parsed.dataStructures[0].revoked).toBe(true)

        const [geoportal, grafana, nodered] = parsed.addons.map((row) => parseCatalogAddon(row)!)
        expect(geoportal.listing.install?.source).toMatchObject({ ref: shaA, releaseTag: null })
        expect(grafana.listing.install?.source).toMatchObject({ ref: shaB, releaseTag: 'v2.0-rc' })
        expect(nodered.listing.install).toBeUndefined()
        expect(nodered.missingForInstall.join(' ')).toMatch(/Commit-Pin/)
    })
})
