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

const SHA_REF: AddonPackageRef = { ...TAG_REF, ref: SHA, releaseTag: 'v2.0-rc' }

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    })
}

/** Stubs the tree and raw-file API of one tiny two-file package. */
function stubGitlab() {
    return vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        // Nothing may ever be resolved — the pin IS the commit.
        expect(url).not.toContain('/repository/tags/')
        expect(url).not.toContain('/repository/commits/')
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

    it('refuses any non-commit pin without touching the network', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        for (const ref of ['v2.0-rc', 'main', 'cafebabe', SHA.slice(0, 8)]) {
            const failure = await resolvePinnedCommit({ ...TAG_REF, ref }).catch(
                (error: unknown) => error,
            )
            expect(failure).toBeInstanceOf(PackageFetchError)
            expect((failure as PackageFetchError).message).toMatch(/kein Commit-Pin/)
        }
        expect(fetchMock).not.toHaveBeenCalled()
    })
})

describe('fetchAddonPackage', () => {
    it('fetches every file at the pinned commit', async () => {
        const fetchMock = stubGitlab()
        vi.stubGlobal('fetch', fetchMock)

        const { files, commit } = await fetchAddonPackage(SHA_REF)
        expect(commit).toBe(SHA)
        expect(Object.keys(files).sort()).toEqual(['charts/values.yaml', 'civitas-component.yaml'])
    })
})
