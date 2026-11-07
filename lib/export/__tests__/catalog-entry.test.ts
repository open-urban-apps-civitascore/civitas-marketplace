import { describe, expect, it } from 'vitest'

import { applyCatalogEntry, applyTextEdit, buildCatalogEntry, indexRowOf, isListed, listedRowOf, maintainerOf } from '@/lib/export/catalog-entry'

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
        // A tombstone is in the file but hidden everywhere else. Counting it as
        // listed is how the status step came to contradict the catalog step,
        // which refuses a re-share onto a withdrawn id outright.
        const withdrawn = index([{ ...entry(), revoked: true }])
        expect(isListed(withdrawn, 'urn:musterstadt:usecase:kiez-baumkataster', '1.0.0')).toBe(false)
    })
})

describe('indexRowOf', () => {
    const ID = 'urn:musterstadt:usecase:kiez-baumkataster'

    it('reads the version of a row, and whether and why it was withdrawn', () => {
        expect(indexRowOf(index([entry()]), ID)).toEqual({ version: '1.0.0', revoked: false })
        expect(indexRowOf(index([{ ...entry(), revoked: true, revokedReason: '  Datenquelle abgeschaltet ' }]), ID)).toEqual({
            version: '1.0.0',
            revoked: true,
            reason: 'Datenquelle abgeschaltet',
        })
    })

    it('tells a missing row from an index nobody can read', () => {
        expect(indexRowOf(index([]), ID)).toBeUndefined()
        expect(indexRowOf('not json', ID)).toBeNull()
    })
})

describe('maintainerOf', () => {
    const ID = 'urn:musterstadt:usecase:kiez-baumkataster'

    it('reads whom the index names as the Herausgeber', () => {
        expect(maintainerOf(index([entry()]), ID)).toBe('Stadt Musterstadt')
    })

    it('names nobody for a row without one, no row, or an index nobody can read', () => {
        expect(maintainerOf(index([{ ...entry(), maintainer: '  ' }]), ID)).toBeUndefined()
        expect(maintainerOf(index([{ id: ID, version: '1.0.0' }]), ID)).toBeUndefined()
        expect(maintainerOf(index([]), ID)).toBeUndefined()
        expect(maintainerOf('not json', ID)).toBeUndefined()
    })
})

const ENTRY_ID = 'urn:musterstadt:usecase:kiez-baumkataster'

describe('applyTextEdit', () => {
    const now = new Date('2026-11-07T12:00:00.000Z')
    const curation = { tier: 'verified', reviewedBy: 'Civitas Connect e. V.', reviewedAt: '2026-10-01' }
    const row = () => ({
        ...entry(),
        themes: ['umwelt-klima'],
        contact: { email: 'alt@musterstadt.example' },
        implementation: { operator: 'Stadt Musterstadt' },
        curation,
        addedByHand: 'bleibt',
    })
    const texts = { displayName: 'Baumkataster im Kiez', description: 'Neu beschrieben', keywords: ['baum'], metadata: { themes: ['umwelt-klima' as const] } }
    const edited = (edit: ReturnType<typeof applyTextEdit>) => {
        if (edit.status !== 'changed') throw new Error(`expected a change, got ${edit.status}`)
        return { index: JSON.parse(edit.content), indexVersion: edit.indexVersion }
    }

    it('changes the texts and nothing that decides what gets installed or who answers for it', () => {
        const { index: next, indexVersion } = edited(applyTextEdit(index([row()]), ENTRY_ID, '1.0.0', texts, now))
        const [after] = next.useCases
        expect(after).toMatchObject({ displayName: 'Baumkataster im Kiez', description: 'Neu beschrieben', keywords: ['baum'] })
        const before: Record<string, unknown> = row()
        for (const key of ['id', 'type', 'version', 'maintainer', 'license', 'deploymentRef', 'curation', 'addedByHand'] as const) {
            expect(after[key]).toEqual(before[key])
        }
        expect(next.version).toBe('3.0.1')
        expect(indexVersion).toBe('3.0.1')
        expect(next.updatedAt).toBe('2026-11-07T12:00:00Z')
    })

    it('removes a block the author cleared, and keeps the row where it was', () => {
        const other = { id: 'urn:musterstadt:usecase:anderes', version: '2.0.0' }
        const { index: next } = edited(applyTextEdit(index([other, row()]), ENTRY_ID, '1.0.0', texts, now))
        expect(next.useCases[0]).toEqual(other)
        expect(next.useCases[1]).not.toHaveProperty('contact')
        expect(next.useCases[1]).not.toHaveProperty('implementation')
    })

    it('says so when nothing changes', () => {
        const same = { displayName: 'Kiez-Baumkataster', description: 'Bäume im Kiez', keywords: ['baumkataster'], metadata: {} }
        expect(applyTextEdit(index([entry()]), ENTRY_ID, '1.0.0', same, now)).toEqual({ status: 'unchanged' })
    })

    it('keeps fields the form does not know inside a block, in their places', () => {
        const byHand = {
            ...row(),
            contact: { website: 'bleibt', email: 'alt@musterstadt.example' },
            implementation: { operatorOrg: 'musterstadt', operator: 'Stadt Musterstadt', resources: { byHand: 1, note: 'alt' } },
        }
        const metadata = { contact: { email: 'neu@musterstadt.example' }, implementation: { operator: 'Stadt Musterstadt', resources: { note: 'neu' } } }
        const { index: next } = edited(applyTextEdit(index([byHand]), ENTRY_ID, '1.0.0', { ...texts, metadata }, now))
        expect(next.useCases[0].contact).toEqual({ website: 'bleibt', email: 'neu@musterstadt.example' })
        expect(next.useCases[0].implementation).toEqual({ operatorOrg: 'musterstadt', operator: 'Stadt Musterstadt', resources: { byHand: 1, note: 'neu' } })
        expect(Object.keys(next.useCases[0].implementation)).toEqual(['operatorOrg', 'operator', 'resources'])
    })

    it('still takes out a block the form left empty, and calls a row with such fields unchanged', () => {
        const byHand = { ...entry(), contact: { website: 'x', email: 'alt@musterstadt.example' } }
        const same = { displayName: 'Kiez-Baumkataster', description: 'Bäume im Kiez', keywords: ['baumkataster'] }
        expect(applyTextEdit(index([byHand]), ENTRY_ID, '1.0.0', { ...same, metadata: { contact: { email: 'alt@musterstadt.example' } } }, now)).toEqual({ status: 'unchanged' })
        expect(edited(applyTextEdit(index([byHand]), ENTRY_ID, '1.0.0', { ...same, metadata: {} }, now)).index.useCases[0].contact).toBeUndefined()
    })

    it('refuses another version and a withdrawn entry, as the person looked at something else', () => {
        expect(applyTextEdit(index([row()]), ENTRY_ID, '1.0.1', texts, now)).toEqual({ status: 'not-listed' })
        expect(applyTextEdit(index([{ ...row(), revoked: true }]), ENTRY_ID, '1.0.0', texts, now)).toEqual({ status: 'not-listed' })
    })
})

describe('listedRowOf', () => {
    it('gives the row of exactly this version', () => {
        const raw = listedRowOf(index([{ ...entry(), description: 'Im Katalog geändert' }]), ENTRY_ID, '1.0.0')
        expect(JSON.parse(raw as string)).toMatchObject({ id: ENTRY_ID, description: 'Im Katalog geändert' })
    })

    it('gives nothing for another version, a withdrawn entry or an index nobody can read', () => {
        expect(listedRowOf(index([entry()]), ENTRY_ID, '2.0.0')).toBeUndefined()
        expect(listedRowOf(index([{ ...entry(), revoked: true }]), ENTRY_ID, '1.0.0')).toBeUndefined()
        expect(listedRowOf('not json', ENTRY_ID, '1.0.0')).toBeUndefined()
    })
})
