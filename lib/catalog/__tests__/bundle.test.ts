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
    'https://gitlab.example/civitascore-openurbanapps/commune-musterhausen-trafficcounter'

const COMMIT = '9bef74ce374647c776e0249337a4af111bc7cd3b'

const SUMMARY: CatalogSummary = {
    ...traffic.manifest,
    deploymentRef: { url: REPO_URL, ref: COMMIT, releaseTag: 'v2.0.0', path: '.' },
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

function stubRepo(overrides: { manifest?: unknown; missing?: string; path?: string } = {}) {
    const manifest = overrides.manifest ?? traffic.manifest
    const dir = overrides.path ? `${overrides.path}/` : ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        // The pin IS the commit — no resolution API may ever be consulted.
        expect(url).not.toContain('/api/v4/')
        expect(url).toContain(`/-/raw/${COMMIT}/${dir}core-ir/`)
        const file = url.split('/core-ir/')[1]
        if (file === 'manifest.json') return jsonResponse(manifest)
        if (file === overrides.missing) return new Response('not found', { status: 404 })
        const content = traffic.files[file]
        return content ? jsonResponse(content) : new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('fetchCatalogEntry', () => {
    it('assembles the identical entry the mock source produces, fetched at the pinned commit', async () => {
        stubRepo()
        const { entry, commit } = await fetchCatalogEntry(SUMMARY)
        expect(commit).toBe(COMMIT)
        const viaMock = assembleCatalogEntry(traffic.manifest, (file) => traffic.files[file])
        expect(entry).toEqual(viaMock)
    })

    it('refuses a non-commit pin outright — no network, no fallback', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        const failure = await fetchCatalogEntry({
            ...traffic.manifest,
            deploymentRef: { url: REPO_URL, ref: 'v2.0.0', releaseTag: 'v2.0.0', path: '.' },
        }).catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(BundleError)
        expect((failure as BundleError).message).toMatch(/not a commit SHA/)
        expect((failure as BundleError).status).toBe(502)
        expect(fetchMock).not.toHaveBeenCalled()
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
})
