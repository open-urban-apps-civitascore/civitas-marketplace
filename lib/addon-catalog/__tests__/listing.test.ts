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
    it('a commit pin with explicit releaseTag is installable', () => {
        const parsed = parseCatalogAddon(installableRow({ ref: SHA, releaseTag: 'v2.1.0' }))!
        expect(parsed.missingForInstall).toEqual([])
        expect(parsed.listing.install?.source).toMatchObject({ ref: SHA, releaseTag: 'v2.1.0' })
    })

    it('a commit pin without a release shows no release name', () => {
        const parsed = parseCatalogAddon(installableRow({ ref: SHA }))!
        expect(parsed.listing.install?.source).toMatchObject({ ref: SHA, releaseTag: null })
    })

    it('leftover v2 fields are inert: refType/resolvedCommit neither pin nor label', () => {
        const parsed = parseCatalogAddon(
            installableRow({ ref: SHA, refType: 'commit', resolvedCommit: SHA }),
        )!
        expect(parsed.listing.install?.source).toMatchObject({ ref: SHA, releaseTag: null })
    })

    it('a tag as ref is no longer a pin — the release name belongs in releaseTag', () => {
        const parsed = parseCatalogAddon(installableRow({ ref: 'v2.0-rc' }))!
        expect(parsed.listing.install).toBeUndefined()
        expect(parsed.missingForInstall.join(' ')).toMatch(/Commit-Pin statt „v2.0-rc"/)
    })

    it('a tag pin with a curated resolvedCommit no longer substitutes — migrate the row', () => {
        const parsed = parseCatalogAddon(
            installableRow({ ref: 'v2.0-rc', refType: 'tag', resolvedCommit: SHA }),
        )!
        expect(parsed.listing.install).toBeUndefined()
    })

    it('a row without a pin stays listed but uninstallable', () => {
        const parsed = parseCatalogAddon(installableRow({}))!
        expect(parsed.listing.install).toBeUndefined()
        expect(parsed.missingForInstall.join(' ')).toMatch(/Commit-Pin/)
    })

    it('a branch ref stays uninstallable, resolvedCommit or not', () => {
        const parsed = parseCatalogAddon(installableRow({ ref: 'main', resolvedCommit: SHA }))!
        expect(parsed.listing.install).toBeUndefined()
        expect(parsed.missingForInstall.join(' ')).toMatch(/Commit-Pin statt „main"/)
    })
})
