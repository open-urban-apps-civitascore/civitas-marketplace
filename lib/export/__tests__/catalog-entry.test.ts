import { describe, expect, it } from 'vitest'

import { applyCatalogEntry, buildCatalogEntry, isListed } from '@/lib/export/catalog-entry'

const SHA = 'b95660bc21b90c67f13bae25ef8452c9a8293227'

const entry = () =>
    buildCatalogEntry({
        id: 'urn:musterstadt:usecase:kiez-baumkataster',
        displayName: 'Kiez-Baumkataster',
        description: 'Bäume im Kiez',
        version: '1.0.0',
        maintainer: 'Stadt Musterstadt',
        license: 'EUPL-1.2',
        keywords: ['baumkataster'],
        repoUrl: 'https://gitlab.com/civitascore-openurbanapps/civitas-marketplace-catalog',
        path: 'packages/kiez-baumkataster',
        commitSha: SHA.toUpperCase(),
    })

const index = (useCases: unknown[]) =>
    JSON.stringify({ version: '3.0.0', updatedAt: '2026-08-29T00:00:00Z', addons: [], useCases, dataStructures: [] })

describe('buildCatalogEntry', () => {
    it('produces a v3 row pinned to the lowercase commit', () => {
        const row = entry()
        expect(row.type).toBe('usecase')
        expect(row.deploymentRef).toEqual({
            url: 'https://gitlab.com/civitascore-openurbanapps/civitas-marketplace-catalog',
            ref: SHA,
            releaseTag: null,
            path: 'packages/kiez-baumkataster',
        })
    })
})

describe('applyCatalogEntry', () => {
    const now = new Date('2026-09-08T10:15:30.123Z')

    it('appends a new row, bumps the index version and stamps updatedAt without milliseconds', () => {
        const edit = applyCatalogEntry(index([{ id: 'other', version: '1.0.0' }]), entry(), now)
        expect(edit.status).toBe('added')
        if (edit.status !== 'added') return
        const parsed = JSON.parse(edit.content) as { version: string; updatedAt: string; useCases: unknown[] }
        expect(parsed.version).toBe('3.0.1')
        expect(parsed.updatedAt).toBe('2026-09-08T10:15:30Z')
        expect(parsed.useCases).toHaveLength(2)
        expect(edit.content.endsWith('\n')).toBe(true)
    })

    it('replaces the row of a package already listed at another version', () => {
        const old = { ...entry(), version: '0.9.0', deploymentRef: { url: 'x', ref: '0'.repeat(40), releaseTag: null, path: '.' } }
        const edit = applyCatalogEntry(index([old]), entry(), now)
        expect(edit.status).toBe('replaced')
        if (edit.status !== 'replaced') return
        expect(edit.previousVersion).toBe('0.9.0')
        expect((JSON.parse(edit.content) as { useCases: unknown[] }).useCases).toHaveLength(1)
    })

    it('is a no-op when the same version is already pinned to the same commit', () => {
        expect(applyCatalogEntry(index([entry()]), entry(), now).status).toBe('unchanged')
    })

    it('answers the listed question', () => {
        expect(isListed(index([entry()]), 'urn:musterstadt:usecase:kiez-baumkataster', '1.0.0')).toBe(true)
        expect(isListed(index([entry()]), 'urn:musterstadt:usecase:kiez-baumkataster', '1.1.0')).toBe(false)
        expect(isListed('not json', 'x', '1')).toBe(false)
    })
})
