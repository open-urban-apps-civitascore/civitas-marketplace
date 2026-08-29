import { describe, expect, it } from 'vitest'

import { parseCatalogAddon } from '../listing'

const SHA = '9bef74ce374647c776e0249337a4af111bc7cd3b'

/** The smallest row that yields an installable listing. */
function installableRow(deploymentRef: Record<string, unknown>): Record<string, unknown> {
    return {
        id: 'grafana',
        name: 'Grafana',
        description: 'Dashboards',
        author: 'Civitas Connect e. V.',
        categories: ['Dashboard'],
        compatibility: [{ coreVersion: '2.0' }],
        install: { componentName: 'grafana', subdomain: 'grafana' },
        curation: { tier: 'verified', reviewedBy: 'Open Urban Apps', reviewedAt: '2026-08-10' },
        deploymentRef: {
            type: 'git',
            url: 'https://gitlab.com/civitas-connect/grafana',
            path: '.',
            ...deploymentRef,
        },
    }
}

describe('parseCatalogAddon pin handling', () => {
    it('legacy tag pin: the tag doubles as the release name', () => {
        const parsed = parseCatalogAddon(installableRow({ ref: 'v2.0-rc', refType: 'tag' }))!
        expect(parsed.missingForInstall).toEqual([])
        expect(parsed.listing.install?.source).toMatchObject({
            ref: 'v2.0-rc',
            releaseTag: 'v2.0-rc',
        })
    })

    it('legacy commit pin: no release name to show', () => {
        const parsed = parseCatalogAddon(installableRow({ ref: SHA, refType: 'commit' }))!
        expect(parsed.listing.install?.source).toMatchObject({ ref: SHA, releaseTag: null })
    })

    it('new shape: commit pin with explicit releaseTag', () => {
        const parsed = parseCatalogAddon(installableRow({ ref: SHA, releaseTag: 'v2.1.0' }))!
        expect(parsed.listing.install?.source).toMatchObject({ ref: SHA, releaseTag: 'v2.1.0' })
    })

    it('a legacy tag pin with a curated resolvedCommit is pinned to that commit', () => {
        const parsed = parseCatalogAddon(
            installableRow({ ref: 'v2.0-rc', refType: 'tag', resolvedCommit: SHA }),
        )!
        expect(parsed.missingForInstall).toEqual([])
        expect(parsed.listing.install?.source).toMatchObject({
            ref: SHA,
            releaseTag: 'v2.0-rc',
        })
    })

    it('a row without a pin stays listed but uninstallable', () => {
        const parsed = parseCatalogAddon(installableRow({}))!
        expect(parsed.listing.install).toBeUndefined()
        expect(parsed.missingForInstall.join(' ')).toMatch(/Feste Version/)
    })

    it('a branch ref stays uninstallable even with a curated resolvedCommit', () => {
        const parsed = parseCatalogAddon(installableRow({ ref: 'main', resolvedCommit: SHA }))!
        expect(parsed.listing.install).toBeUndefined()
        expect(parsed.missingForInstall.join(' ')).toMatch(/Unveränderliche Version/)
    })

    it('still refuses a branch-like ref as mutable', () => {
        const parsed = parseCatalogAddon(installableRow({ ref: 'main', refType: 'tag' }))!
        expect(parsed.listing.install).toBeUndefined()
        expect(parsed.missingForInstall.join(' ')).toMatch(/Unveränderliche Version/)
    })
})
