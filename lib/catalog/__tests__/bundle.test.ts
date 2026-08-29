import { afterEach, describe, expect, it, vi } from 'vitest'

import { assembleCatalogEntry } from '@/lib/catalog/assemble'
import { BundleError, fetchCatalogEntry } from '@/lib/catalog/bundle'
import type { CatalogSummary } from '@/lib/catalog/types'
import { mockPackages } from '@/lib/mock-catalog'

/**
 * The remote path is served the EXACT fixture content over a stubbed fetch —
 * proving that a GitLab-sourced install assembles the identical entry the
 * mock source produces (fixture == repo content by construction).
 */

const traffic = mockPackages.find(
    (pkg) => pkg.manifest.id === 'urn:openurbanapps:usecase:verkehrszaehlung',
)!

const REPO_URL =
    'https://gitlab.example/civitascore-openurbanapps/commune-mittelerde-trafficcounter'

// A legacy-shaped row after parsing: tag pin, tag doubles as the release name.
const SUMMARY: CatalogSummary = {
    ...traffic.manifest,
    deploymentRef: { url: REPO_URL, ref: 'v2.0.0', releaseTag: 'v2.0.0', path: '.' },
}

const COMMIT = '9bef74ce374647c776e0249337a4af111bc7cd3b'

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

function stubRepo(overrides: { manifest?: unknown; missing?: string; path?: string } = {}) {
    const manifest = overrides.manifest ?? traffic.manifest
    const dir = overrides.path ? `${overrides.path}/` : ''
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input)
            if (url.includes('/api/v4/projects/')) {
                // A tag pin must resolve through the TAGS endpoint — a branch
                // name cannot satisfy it — and the SHA sits in its commit node.
                expect(url).toContain(`/repository/tags/${encodeURIComponent('v2.0.0')}`)
                return jsonResponse({ name: 'v2.0.0', commit: { id: COMMIT } })
            }
            // Everything else must be fetched at the resolved commit, not the tag.
            expect(url).toContain(`/-/raw/${COMMIT}/${dir}core-ir/`)
            const file = url.split('/core-ir/')[1]
            if (file === 'manifest.json') return jsonResponse(manifest)
            if (file === overrides.missing) return new Response('not found', { status: 404 })
            const content = traffic.files[file]
            return content ? jsonResponse(content) : new Response('not found', { status: 404 })
        }),
    )
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('fetchCatalogEntry', () => {
    it('assembles the identical entry the mock source produces, pinned to the resolved commit', async () => {
        stubRepo()
        const { entry, commit } = await fetchCatalogEntry(SUMMARY)
        expect(commit).toBe(COMMIT)
        const viaMock = assembleCatalogEntry(traffic.manifest, (file) => traffic.files[file])
        expect(entry).toEqual(viaMock)
    })

    it('fetches a commit-pinned row directly at the SHA, without a resolution call', async () => {
        stubRepo()
        const { commit } = await fetchCatalogEntry({
            ...traffic.manifest,
            deploymentRef: { url: REPO_URL, ref: COMMIT, releaseTag: 'v2.0.0', path: '.' },
        })
        expect(commit).toBe(COMMIT)
        const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]))
        expect(calls.some((url) => url.includes('/api/v4/projects/'))).toBe(false)
    })

    it('refuses the install when a legacy tag pin cannot be resolved (fail-closed)', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input)
            if (url.includes('/api/v4/projects/')) return new Response('gone', { status: 404 })
            throw new Error(`STUB: content fetch attempted for ${url}`)
        })
        vi.stubGlobal('fetch', fetchMock)
        const failure = await fetchCatalogEntry(SUMMARY).catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(BundleError)
        // The production refusal, not the stub's guard message.
        expect((failure as BundleError).message).toMatch(/could not be resolved/)
        expect((failure as BundleError).status).toBe(502)
        // Exactly one request: the resolution attempt. No content was fetched.
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('cannot be talked into resolving a branch: non-tag refs miss the tags endpoint', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input)
            // A branch name is no tag — GitLab's tags endpoint answers 404.
            if (url.includes('/repository/tags/')) return new Response('no tag', { status: 404 })
            throw new Error(`STUB: unexpected request ${url}`)
        })
        vi.stubGlobal('fetch', fetchMock)
        const failure = await fetchCatalogEntry({
            ...traffic.manifest,
            deploymentRef: {
                url: REPO_URL,
                ref: 'feature-branch',
                releaseTag: null,
                path: '.',
            },
        }).catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(BundleError)
        expect((failure as BundleError).message).toMatch(/could not be resolved/)
        // The branch ref must never have been offered to the commits endpoint,
        // which WOULD resolve it on real GitLab.
        const calls = fetchMock.mock.calls.map((call) => String(call[0]))
        expect(calls.some((url) => url.includes('/repository/commits/'))).toBe(false)
    })

    it('refuses a manifest whose member file name would escape the pinned URL segment', async () => {
        stubRepo({
            manifest: {
                ...traffic.manifest,
                members: {
                    ...traffic.manifest.members,
                    dataStructures: [{ file: '../../main/core-ir/evil.json' }],
                },
            },
        })
        await expect(fetchCatalogEntry(SUMMARY)).rejects.toThrow(/not a plain file name/)
    })

    it('refuses a package whose id does not match the catalogue row', async () => {
        stubRepo({ manifest: { ...traffic.manifest, id: 'urn:openurbanapps:usecase:andere' } })
        await expect(fetchCatalogEntry(SUMMARY)).rejects.toThrow(BundleError)
        await expect(fetchCatalogEntry(SUMMARY)).rejects.toThrow(/does not match catalogue row/)
    })

    it('refuses a package whose version does not match the catalogue row', async () => {
        stubRepo({ manifest: { ...traffic.manifest, version: '9.9.9' } })
        await expect(fetchCatalogEntry(SUMMARY)).rejects.toThrow(/version/)
    })

    it('reports a missing member file as a 424', async () => {
        stubRepo({ missing: 'zaehlung-zu-messung.mapping.json' })
        const failure = await fetchCatalogEntry(SUMMARY).catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(BundleError)
        expect((failure as BundleError).status).toBe(424)
    })

    it('refuses a summary without a source pointer', async () => {
        await expect(fetchCatalogEntry({ ...traffic.manifest })).rejects.toThrow(/no source/)
    })

    it('fetches package content under the pinned path for monorepo rows', async () => {
        stubRepo({ path: 'usecases/traffic' })
        const { commit } = await fetchCatalogEntry({
            ...traffic.manifest,
            deploymentRef: {
                url: REPO_URL,
                ref: COMMIT,
                releaseTag: null,
                path: 'usecases/traffic',
            },
        })
        expect(commit).toBe(COMMIT)
    })
})
