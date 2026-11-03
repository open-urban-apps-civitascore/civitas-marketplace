import { describe, expect, it } from 'vitest'

import { awaitRelease, releaseUseCase, type PlatformAnswer, type PlatformApi, type WaitOptions } from '@/lib/release-chain'

/** A platform as far as the release needs it: statuses that the POSTs change, and a saga that ends after some reads. */
interface FakeState {
    versions: Record<string, { id: string; dataStructureVersionStatus: string }[]>
    structures: Record<string, string>
    sources: Record<string, string>
    dataset: { dataSetStatus: string; pendingSagaType: string | null; provisioned: boolean }
    /** POST paths answered with this status instead of being carried out. */
    refuse?: Record<string, number>
    /** How many reads of the dataset the saga lasts, and how it ends. */
    saga?: { reads: number; outcome: 'completed' | 'failed' }
}

function fakePlatform(state: FakeState): { api: PlatformApi; posts: string[] } {
    const posts: string[] = []
    let sagaReads = 0
    const answer = (status: number, value?: unknown): PlatformAnswer => ({
        status,
        statusText: '',
        text: value === undefined ? '' : JSON.stringify(value),
    })
    const api: PlatformApi = {
        async get(path) {
            let match = path.match(/^\/v1\/datastructures\/([^/]+)\/versions(\?.*)?$/)
            if (match) return answer(405, { detail: "Request method 'GET' is not supported" })

            match = path.match(/^\/v1\/datastructures\/([^/]+)$/)
            if (match) return answer(200, { dataStructureStatus: state.structures[match[1]], dataStructureVersions: state.versions[match[1]] ?? [] })
            match = path.match(/^\/v1\/datasources\/([^/]+)$/)
            if (match) return answer(200, { dataSourceStatus: state.sources[match[1]] })
            if (path === '/v1/datasets/ds') {
                if (state.dataset.pendingSagaType && state.saga && ++sagaReads > state.saga.reads) {
                    state.dataset.pendingSagaType = null
                    if (state.saga.outcome === 'completed') state.dataset.provisioned = true
                    else state.dataset.dataSetStatus = 'READY'
                }
                return answer(200, state.dataset)
            }
            return answer(404)
        },
        async post(path) {
            posts.push(path)
            const refusal = state.refuse?.[path]
            if (refusal) return answer(refusal, { detail: 'Abgelehnt' })
            const version = path.match(/^\/v1\/datastructures\/([^/]+)\/versions\/([^/]+)\/release$/)
            if (version) {
                for (const row of state.versions[version[1]]) if (row.id === version[2]) row.dataStructureVersionStatus = 'AVAILABLE'
                return answer(200, {})
            }
            const structure = path.match(/^\/v1\/datastructures\/([^/]+)\/release$/)
            if (structure) state.structures[structure[1]] = 'AVAILABLE'
            const source = path.match(/^\/v1\/datasources\/([^/]+)\/release$/)
            if (source) state.sources[source[1]] = 'AVAILABLE'
            if (path === '/v1/datasets/ds/stage') state.dataset.dataSetStatus = 'READY'
            if (path === '/v1/datasets/ds/release') {
                state.dataset.dataSetStatus = 'AVAILABLE'
                state.dataset.pendingSagaType = 'CREATE'
            }
            return answer(200, {})
        },
    }
    return { api, posts }
}

/** A fresh install: everything a draft, besides one structure the install reused. */
function installed(): FakeState {
    return {
        versions: {
            s1: [{ id: 'v1', dataStructureVersionStatus: 'DRAFT' }],
            s2: [{ id: 'v2', dataStructureVersionStatus: 'AVAILABLE' }],
        },
        structures: { s1: 'DRAFT', s2: 'AVAILABLE' },
        sources: { src1: 'DRAFT' },
        dataset: { dataSetStatus: 'DRAFT', pendingSagaType: null, provisioned: false },
    }
}

const TARGETS = { dataSetId: 'ds', structureIds: ['s1', 's2'], sourceIds: ['src1'] }

function fakeClock(): WaitOptions & { elapsed: () => number } {
    let clock = 0
    return {
        timeoutMs: 10_000,
        intervalMs: 1_000,
        now: () => clock,
        sleep: async (ms) => {
            clock += ms
        },
        elapsed: () => clock,
    }
}

describe('releaseUseCase', () => {
    it('releases the drafts in the order the platform demands, and nothing twice', async () => {
        const { api, posts } = fakePlatform(installed())

        const start = await releaseUseCase(api, TARGETS)

        expect(start).toEqual({ state: 'started', released: { versions: 1, structures: 1, sources: 1 } })
        expect(posts).toEqual([
            '/v1/datastructures/s1/versions/v1/release',
            '/v1/datastructures/s1/release',
            '/v1/datasources/src1/release',
            '/v1/datasets/ds/stage',
            '/v1/datasets/ds/release',
        ])
    })

    it('stops at the first refusal and names its step', async () => {
        const state = { ...installed(), refuse: { '/v1/datasources/src1/release': 403 } }
        const { api, posts } = fakePlatform(state)

        const start = await releaseUseCase(api, TARGETS)

        expect(start).toMatchObject({ state: 'refused', step: 'source', answer: { status: 403 } })
        expect(posts).not.toContain('/v1/datasets/ds/stage')
    })

    it('goes on where an earlier run stopped', async () => {
        const state = installed()
        state.versions.s1[0].dataStructureVersionStatus = 'AVAILABLE'
        state.structures.s1 = 'AVAILABLE'
        state.sources.src1 = 'AVAILABLE'
        state.dataset.dataSetStatus = 'READY'
        const { api, posts } = fakePlatform(state)

        await releaseUseCase(api, TARGETS)

        expect(posts).toEqual(['/v1/datasets/ds/release'])
    })
})

describe('awaitRelease', () => {
    it('reports a completed saga once the platform clears it', async () => {
        const { api } = fakePlatform({ ...installed(), saga: { reads: 3, outcome: 'completed' } })
        await releaseUseCase(api, TARGETS)
        const clock = fakeClock()

        expect(await awaitRelease(api, 'ds', clock)).toBe('completed')
        expect(clock.elapsed()).toBe(3_000)
    })

    it('reports a failed saga when the platform reverts the dataset', async () => {
        const { api } = fakePlatform({ ...installed(), saga: { reads: 1, outcome: 'failed' } })
        await releaseUseCase(api, TARGETS)

        expect(await awaitRelease(api, 'ds', fakeClock())).toBe('failed')
    })

    it('stops waiting at the time limit', async () => {
        const { api } = fakePlatform({ ...installed(), saga: { reads: 100, outcome: 'completed' } })
        await releaseUseCase(api, TARGETS)
        const clock = fakeClock()

        expect(await awaitRelease(api, 'ds', clock)).toBe('pending')
        expect(clock.elapsed()).toBe(10_000)
    })

    it('reads a dataset released before as completed, without releasing anything', async () => {
        const state = installed()
        state.dataset = { dataSetStatus: 'AVAILABLE', pendingSagaType: null, provisioned: true }
        const { api, posts } = fakePlatform(state)

        expect(await awaitRelease(api, 'ds', fakeClock())).toBe('completed')
        expect(posts).toEqual([])
    })
})
