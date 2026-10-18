import { describe, expect, it } from 'vitest'

import { metadataDraft } from '@/lib/export/metadata'
import { draftKey, draftOwnerTag, draftStartedOn, draftStepAt, draftTime, parseDraft, readDrafts, removeDraft, writeDraft, type DraftStorage, type ShareDraft } from '@/lib/export/share-drafts'

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
    step: 2,
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
        // A step the wizard of its kind never had: 3 in the three-step one, 1 in the four-step one, an unknown wizard.
        storage.setItem(draftKey(owner, 'v'), JSON.stringify({ ...draft('v', '2026-10-16T10:00:00.000Z'), steps: 3, step: 3 }))
        storage.setItem(draftKey(owner, 'w'), JSON.stringify({ ...draft('w', '2026-10-16T10:00:00.000Z'), step: 1 }))
        storage.setItem(draftKey(owner, 'u'), JSON.stringify({ ...draft('u', '2026-10-16T10:00:00.000Z'), steps: 5 }))
        storage.setItem(draftKey(owner, 't'), JSON.stringify({ ...draft('t', '2026-10-16T10:00:00.000Z'), steps: 3, startedAt: 'last week' }))
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

    it('reads a draft of the four-step wizard one step lower, under its old key, without rewriting it', () => {
        const storage = memoryStorage()
        // As the wizard before rc.5 wrote them, under the same key: no step count, 2 = „Bestand prüfen“, 3 = the Steckbrief.
        const inventory = JSON.stringify({ ...draft('a', '2026-10-16T10:00:00.000Z'), step: 2 })
        storage.setItem(`marketplace.share-draft.v1:${owner}:a`, inventory)
        storage.setItem(`marketplace.share-draft.v1:${owner}:b`, JSON.stringify({ ...draft('b', '2026-10-16T10:00:00.000Z'), step: 3 }))
        expect(draftKey(owner, 'a')).toBe(`marketplace.share-draft.v1:${owner}:a`)
        expect(readDrafts(storage, owner).map((entry) => `${entry.datasetId}:${entry.step}`).sort()).toEqual(['a:1', 'b:2'])
        expect(storage.map.get(draftKey(owner, 'a'))).toBe(inventory)
        expect(storage.map.size).toBe(2)
    })

    it('writes the step count along, so a draft of the three-step wizard reads back as it was saved', () => {
        const storage = memoryStorage()
        writeDraft(storage, owner, { ...draft('a', '2026-10-16T10:00:00.000Z'), step: 2 })
        writeDraft(storage, owner, { ...draft('b', '2026-10-16T10:00:00.000Z'), step: 1 })
        expect(JSON.parse(storage.map.get(draftKey(owner, 'a'))!)).toMatchObject({ steps: 3, step: 2 })
        const read = readDrafts(storage, owner)
        expect(read.map((entry) => `${entry.datasetId}:${entry.step}`).sort()).toEqual(['a:2', 'b:1'])
        // The step count is how it is stored, not part of the draft.
        expect(read[0]).not.toHaveProperty('steps')
    })

    it('starts a draft only from the Steckbrief on, and keeps one that exists up to date in „Auswählen“', () => {
        expect(draftStepAt(1, false)).toBeUndefined()
        expect(draftStepAt(1, true)).toBe(1)
        expect(draftStepAt(2, false)).toBe(2)
        // The preview is made again from the Steckbrief, so it comes back there.
        expect(draftStepAt(3, true)).toBe(2)
    })

    it('says when a share was started, and for an older draft when it was last saved', () => {
        const saved = draft('a', '2026-10-16T10:00:00.000Z')
        expect(draftStartedOn({ ...saved, startedAt: '2026-10-11T22:30:00.000Z' })).toBe('12.10.')
        expect(draftStartedOn(saved)).toBe('16.10.')
        expect(parseDraft(JSON.stringify({ ...saved, steps: 3, startedAt: '2026-10-12T08:00:00.000Z' }))?.startedAt).toBe('2026-10-12T08:00:00.000Z')
    })
})
