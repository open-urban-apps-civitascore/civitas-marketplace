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

const SUMMARY: CatalogSummary = {
    ...traffic.manifest,
    source: {
        repoUrl: 'https://gitlab.example/civitascore-openurbanapps/commune-mittelerde-trafficcounter',
        gitIdentifier: 'v2.0.0',
    },
}

const COMMIT = 'abc123def456'

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

function stubRepo(overrides: { manifest?: unknown; missing?: string } = {}) {
    const manifest = overrides.manifest ?? traffic.manifest
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input)
            if (url.includes('/api/v4/projects/')) {
                expect(url).toContain(encodeURIComponent('v2.0.0'))
                return jsonResponse({ id: COMMIT })
            }
            // Everything else must be fetched at the resolved commit, not the tag.
            expect(url).toContain(`/-/raw/${COMMIT}/core-ir/`)
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
