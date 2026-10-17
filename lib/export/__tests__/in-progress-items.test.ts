import { describe, expect, it } from 'vitest'

import type { SharedPackageRow } from '@/lib/export-actions'
import { compactList, inProgressItems, isMine } from '@/lib/export/in-progress-items'
import type { ShareDraft } from '@/lib/export/share-drafts'

const draft = (datasetId: string): ShareDraft => ({
    datasetId,
    datasetName: datasetId,
    savedAt: '2026-10-17T10:00:00.000Z',
    step: 3,
    basics: {},
    metadata: { fields: {}, themes: [], media: [] },
    targetKey: 't',
    demoExcluded: [],
})

const row = (slug: string, facts: Partial<SharedPackageRow>): SharedPackageRow => ({
    key: `t#export/${slug}-1.0.0`,
    targetKey: 't',
    targetLabel: 'Repo',
    slug,
    version: '1.0.0',
    displayName: slug,
    bundleMr: { url: `https://gitlab.example/mr/${slug}`, state: 'merged' },
    ...facts,
})

const verified = { state: 'verified' as const }
const onBase = { state: 'on-base' as const, verification: verified, packageId: 'urn:x:usecase:a' }

const ROWS = [
    row('waiting', { bundleMr: { url: 'u-waiting', state: 'opened' } }),
    row('catalogue', { bundle: onBase, catalog: { state: 'none' } }),
    row('listed', { bundle: onBase, catalog: { state: 'listed' } }),
    row('closed', { bundleMr: { url: 'u-closed', state: 'closed' } }),
    row('broken', { problem: 'GitLab-Fehler (500)' }),
]

describe('inProgressItems', () => {
    it('lists drafts and what someone can still move on, the person’s own moves first', () => {
        const items = inProgressItems([draft('d1')], new Set(['d1']), ROWS)
        expect(items.map((item) => (item.kind === 'draft' ? item.draft.datasetId : item.row.slug))).toEqual([
            'd1',
            'catalogue',
            'broken',
            'waiting',
        ])
        expect(items.filter(isMine)).toHaveLength(3)
    })

    it('marks a draft whose dataset is gone, and keeps it to be deleted', () => {
        const [item] = inProgressItems([draft('gone')], new Set(), [])
        expect(item).toMatchObject({ kind: 'draft', available: false })
    })
})

describe('compactList', () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    const mine = (item: string) => item === 'a' || item === 'e'

    it('shows the first few and counts the rest, and how many of them are the person’s', () => {
        expect(compactList(items, false, 3, mine)).toEqual({ shown: ['a', 'b', 'c'], more: 2, moreMine: 1 })
    })

    it('shows everything when asked to, or when it fits', () => {
        expect(compactList(items, true, 3, mine)).toEqual({ shown: items, more: 0, moreMine: 0 })
        expect(compactList(['a', 'b'], false, 3, mine)).toEqual({ shown: ['a', 'b'], more: 0, moreMine: 0 })
    })
})
