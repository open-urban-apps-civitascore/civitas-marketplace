import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AddonPackageRef } from '../listing'
import { fetchAddonPackageFacts, NO_PACKAGE_FACTS } from '../package-facts'

const SHA = '9bef74ce374647c776e0249337a4af111bc7cd3b'

function ref(overrides: Partial<AddonPackageRef>): AddonPackageRef {
    return { project: 'group/project', ref: 'v1.0.0', releaseTag: 'v1.0.0', path: '.', ...overrides }
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('fetchAddonPackageFacts', () => {
    it('reads the YAML facts at the pinned commit', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input)
            expect(url).toContain(`ref=${SHA}`)
            return new Response('not there', { status: 404 })
        })
        vi.stubGlobal('fetch', fetchMock)

        // Unique ref per test: the module caches successful lookups forever.
        await fetchAddonPackageFacts(ref({ ref: SHA }))
        const yamlReads = fetchMock.mock.calls
            .map((call) => String(call[0]))
            .filter((url) => url.includes('/repository/files/'))
        expect(yamlReads).toHaveLength(4)
    })

    it('reads again after a read that failed, but keeps facts where files are only missing or broken', async () => {
        const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }))
        vi.stubGlobal('fetch', fetchMock)
        const pinned = ref({ ref: 'a'.repeat(40) })

        await fetchAddonPackageFacts(pinned)
        await fetchAddonPackageFacts(pinned)
        expect(fetchMock).toHaveBeenCalledTimes(8)

        fetchMock.mockImplementation(async () => new Response('not there', { status: 404 }))
        await fetchAddonPackageFacts(pinned)
        await fetchAddonPackageFacts(pinned)
        expect(fetchMock).toHaveBeenCalledTimes(12)

        const broken = ref({ ref: 'b'.repeat(40) })
        fetchMock.mockImplementation(async () => new Response('parts: [unclosed', { status: 200 }))
        await fetchAddonPackageFacts(broken)
        await fetchAddonPackageFacts(broken)
        expect(fetchMock).toHaveBeenCalledTimes(16)
    })

    it('returns empty facts for a non-commit pin — nothing is read at a mutable ref', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        const facts = await fetchAddonPackageFacts(ref({ ref: 'v9.9.9-unresolvable' }))
        expect(facts).toEqual(NO_PACKAGE_FACTS)
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
