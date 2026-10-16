import { describe, expect, it } from 'vitest'

import { metadataDraft } from '@/lib/export/metadata'
import { draftKey, draftOwnerTag, draftTime, parseDraft, readDrafts, removeDraft, writeDraft, type DraftStorage, type ShareDraft } from '@/lib/export/share-drafts'

/** The Web Storage API over a Map, as a browser offers it. */
function memoryStorage(): DraftStorage & { map: Map<string, string> } {
    const map = new Map<string, string>()
    return {
        map,
        get length() {
            return map.size
        },
        key: (index) => [...map.keys()][index] ?? null,
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => void map.set(key, value),
        removeItem: (key) => void map.delete(key),
    }
}

const draft = (datasetId: string, savedAt: string): ShareDraft => ({
    datasetId,
    datasetName: `Datensatz ${datasetId}`,
    savedAt,
    step: 3,
    basics: { displayName: 'Bodenfeuchte', version: '1.0.0' },
    metadata: metadataDraft(),
    targetKey: 'https://gitlab.example/group/catalog',
    demoExcluded: ['stream-2'],
})

describe('share drafts', () => {
    const owner = draftOwnerTag('ewa@example.org')

    it('keeps one draft per dataset and hands them back newest first', () => {
        const storage = memoryStorage()
        writeDraft(storage, owner, draft('a', '2026-10-16T10:00:00.000Z'))
        writeDraft(storage, owner, draft('b', '2026-10-16T12:00:00.000Z'))
        writeDraft(storage, owner, draft('a', '2026-10-16T13:00:00.000Z'))
        expect(readDrafts(storage, owner).map((entry) => `${entry.datasetId}@${entry.savedAt.slice(11, 13)}`)).toEqual(['a@13', 'b@12'])
    })

    it("keeps people apart, and stores no e-mail address", () => {
        const storage = memoryStorage()
        writeDraft(storage, owner, draft('a', '2026-10-16T10:00:00.000Z'))
        expect(readDrafts(storage, draftOwnerTag('someone@example.org'))).toEqual([])
        expect([...storage.map.keys()].join()).not.toContain('@')
        expect(draftOwnerTag(' Ewa@Example.org ')).toBe(owner)
    })

    it('forgets a draft on request', () => {
        const storage = memoryStorage()
        writeDraft(storage, owner, draft('a', '2026-10-16T10:00:00.000Z'))
        removeDraft(storage, owner, 'a')
        expect(readDrafts(storage, owner)).toEqual([])
    })

    it('ignores damaged entries and entries of another shape', () => {
        const storage = memoryStorage()
        storage.setItem(draftKey(owner, 'x'), '{not json')
        storage.setItem(draftKey(owner, 'y'), JSON.stringify({ ...draft('y', '2026-10-16T10:00:00.000Z'), step: 4 }))
        storage.setItem(draftKey(owner, 'z'), JSON.stringify({ ...draft('z', 'yesterday') }))
        expect(readDrafts(storage, owner)).toEqual([])
        expect(parseDraft(JSON.stringify(draft('ok', '2026-10-16T10:00:00.000Z')))?.datasetId).toBe('ok')
    })

    it('keeps working when the browser refuses storage', () => {
        const refusing: DraftStorage = {
            length: 0,
            key: () => null,
            getItem: () => {
                throw new Error('SecurityError')
            },
            setItem: () => {
                throw new Error('QuotaExceededError')
            },
            removeItem: () => {
                throw new Error('SecurityError')
            },
        }
        expect(writeDraft(refusing, owner, draft('a', '2026-10-16T10:00:00.000Z'))).toBe(false)
        expect(readDrafts(refusing, owner)).toEqual([])
        expect(() => removeDraft(refusing, owner, 'a')).not.toThrow()
        expect(readDrafts(undefined, owner)).toEqual([])
    })

    it('names the time of a save in German, in Berlin time', () => {
        expect(draftTime('2026-10-16T12:32:00.000Z')).toBe('16.10., 14:32')
    })
})
