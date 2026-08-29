import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AddonPackageRef } from '../listing'
import { fetchAddonPackage, PackageFetchError, resolvePinnedCommit } from '../package-source'

const SHA = '9bef74ce374647c776e0249337a4af111bc7cd3b'

const TAG_REF: AddonPackageRef = {
    project: 'civitas-connect/grafana',
    ref: 'v2.0-rc',
    releaseTag: 'v2.0-rc',
    path: '.',
}

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    })
}

/** Stubs the commits, tree and raw-file API of one tiny two-file package. */
function stubGitlab() {
    return vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/repository/tags/')) {
            expect(url).toContain(encodeURIComponent('v2.0-rc'))
            return jsonResponse({ name: 'v2.0-rc', commit: { id: SHA } })
        }
        // Tree and file reads must happen at the resolved commit, never the tag.
        expect(url).toContain(`ref=${SHA}`)
        if (url.includes('/repository/tree')) {
            return jsonResponse([
                { path: 'civitas-component.yaml', type: 'blob' },
                { path: 'charts', type: 'tree' },
                { path: 'charts/values.yaml', type: 'blob' },
            ])
        }
        return new Response('content: yes', { status: 200 })
    })
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('resolvePinnedCommit', () => {
    it('returns a full commit SHA as-is, without a network call', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        await expect(resolvePinnedCommit({ ...TAG_REF, ref: SHA })).resolves.toBe(SHA)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refuses a pin the API cannot turn into a commit (fail-closed)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ name: 'v2.0-rc' })))
        const failure = await resolvePinnedCommit(TAG_REF).catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(PackageFetchError)
        expect((failure as PackageFetchError).message).toMatch(/Commit auflösen/)
    })

    it('a branch name fails: the tags endpoint has nothing to answer', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            void input
            return new Response('no tag', { status: 404 })
        })
        vi.stubGlobal('fetch', fetchMock)
        const failure = await resolvePinnedCommit({ ...TAG_REF, ref: 'feature-x' }).catch(
            (error: unknown) => error,
        )
        expect(failure).toBeInstanceOf(PackageFetchError)
        expect((failure as PackageFetchError).status).toBe(404)
        // Never offered to the commits endpoint, which WOULD resolve a branch.
        const calls = fetchMock.mock.calls.map((call) => String(call[0]))
        expect(calls.every((url) => url.includes('/repository/tags/'))).toBe(true)
    })

    it('a short-hash pin must be a prefix of the commit it resolves to', async () => {
        // The commits endpoint resolves branch NAMES too — a branch named in
        // hex ('cafebabe') answers with an unrelated head SHA and is refused.
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ id: SHA })))
        const failure = await resolvePinnedCommit({ ...TAG_REF, ref: 'cafebabe' }).catch(
            (error: unknown) => error,
        )
        expect(failure).toBeInstanceOf(PackageFetchError)
        expect((failure as PackageFetchError).message).toMatch(/Commit auflösen/)
        // While a genuine short hash resolves fine.
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ id: SHA })))
        await expect(resolvePinnedCommit({ ...TAG_REF, ref: SHA.slice(0, 8) })).resolves.toBe(SHA)
    })
})

describe('fetchAddonPackage', () => {
    it('resolves the pin once and fetches every file at that commit', async () => {
        const fetchMock = stubGitlab()
        vi.stubGlobal('fetch', fetchMock)

        const { files, commit } = await fetchAddonPackage(TAG_REF)
        expect(commit).toBe(SHA)
        expect(Object.keys(files).sort()).toEqual(['charts/values.yaml', 'civitas-component.yaml'])

        const resolutionCalls = fetchMock.mock.calls
            .map((call) => String(call[0]))
            .filter((url) => url.includes('/repository/tags/'))
        expect(resolutionCalls).toHaveLength(1)
    })
})
