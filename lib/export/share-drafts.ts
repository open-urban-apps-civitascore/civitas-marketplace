import type { MetadataDraft } from '@/lib/export/metadata'

/**
 * Drafts of the "Teilen" form, kept in the browser until a merge request
 * exists (Ewa, 2026-10-16). Before that, nothing of what someone typed lived
 * outside the open tab, and leaving the page lost all of it.
 *
 * In the browser on purpose, for now: the marketplace keeps no store of its
 * own, and a draft is unfinished, personal work. The price is that a draft
 * stays on the computer it was typed on - said where it is offered. Once the
 * merge request is open, GitLab holds the content, and the draft goes.
 *
 * Saved without validation, as the patterns for long forms advise: a draft is
 * allowed to be incomplete. Read back defensively instead: an entry from an
 * older version, or edited by hand, is dropped rather than trusted.
 */

const PREFIX = 'marketplace.share-draft.v1:'

export interface ShareDraft {
    datasetId: string
    /** The dataset's name when the draft was saved, for a list where the dataset may be gone. */
    datasetName: string
    /** ISO timestamp of the last save. */
    savedAt: string
    /** The step to come back to: the inventory (2) or the Steckbrief (3). */
    step: 2 | 3
    /** The form's basic fields (name, description, version, …). */
    basics: Record<string, string>
    metadata: MetadataDraft
    targetKey: string
    /** Demo streams unticked in step 2. */
    demoExcluded: string[]
}

/** Just enough of the Web Storage API, so tests can hand in a plain object. */
export interface DraftStorage {
    readonly length: number
    key(index: number): string | null
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

/**
 * A short, stable tag for whose drafts these are. The page passes it in, so
 * two people sharing one browser do not see each other's drafts, and no
 * e-mail address ends up in the browser's storage. FNV-1a, which is enough to
 * keep people apart and is no secret.
 */
export function draftOwnerTag(owner: string): string {
    let hash = 0x811c9dc5
    for (const char of owner.trim().toLowerCase()) {
        hash ^= char.codePointAt(0) ?? 0
        hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash.toString(36)
}

export function draftKey(ownerTag: string, datasetId: string): string {
    return `${PREFIX}${ownerTag}:${datasetId}`
}

const isRecordOfStrings = (value: unknown): value is Record<string, string> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((entry) => typeof entry === 'string')

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === 'string')

function isMetadataDraft(value: unknown): value is MetadataDraft {
    if (typeof value !== 'object' || value === null) return false
    const draft = value as Record<string, unknown>
    return (
        isRecordOfStrings(draft.fields) &&
        isStringArray(draft.themes) &&
        Array.isArray(draft.media) &&
        draft.media.every((item) => isRecordOfStrings(item) && ['src', 'alt', 'caption'].every((key) => typeof (item as Record<string, unknown>)[key] === 'string'))
    )
}

/** A stored draft, or undefined when the entry is missing, damaged or of another shape. */
export function parseDraft(raw: string | null): ShareDraft | undefined {
    if (!raw) return undefined
    let value: unknown
    try {
        value = JSON.parse(raw)
    } catch {
        return undefined
    }
    if (typeof value !== 'object' || value === null) return undefined
    const draft = value as Record<string, unknown>
    if (
        typeof draft.datasetId !== 'string' ||
        typeof draft.datasetName !== 'string' ||
        typeof draft.savedAt !== 'string' ||
        Number.isNaN(Date.parse(draft.savedAt)) ||
        (draft.step !== 2 && draft.step !== 3) ||
        !isRecordOfStrings(draft.basics) ||
        !isMetadataDraft(draft.metadata) ||
        typeof draft.targetKey !== 'string' ||
        !isStringArray(draft.demoExcluded)
    ) {
        return undefined
    }
    return draft as unknown as ShareDraft
}

/** Every draft of one person, newest first. Never throws: a browser that blocks storage simply has none. */
export function readDrafts(storage: DraftStorage | undefined, ownerTag: string): ShareDraft[] {
    if (!storage) return []
    const drafts: ShareDraft[] = []
    try {
        const prefix = draftKey(ownerTag, '')
        for (let index = 0; index < storage.length; index++) {
            const key = storage.key(index)
            if (!key?.startsWith(prefix)) continue
            const draft = parseDraft(storage.getItem(key))
            if (draft) drafts.push(draft)
        }
    } catch {
        return []
    }
    return drafts.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

/** False when the browser refused it (storage full or switched off); the form then simply keeps working. */
export function writeDraft(storage: DraftStorage | undefined, ownerTag: string, draft: ShareDraft): boolean {
    if (!storage) return false
    try {
        storage.setItem(draftKey(ownerTag, draft.datasetId), JSON.stringify(draft))
        return true
    } catch {
        return false
    }
}

export function removeDraft(storage: DraftStorage | undefined, ownerTag: string, datasetId: string): void {
    try {
        storage?.removeItem(draftKey(ownerTag, datasetId))
    } catch {
        // Nothing to do: a storage that cannot be written to holds no draft either.
    }
}

const SAVED_AT = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })

/** "16.10., 14:32", the way the page names when a draft was saved. */
export function draftTime(savedAt: string): string {
    return SAVED_AT.format(new Date(savedAt))
}
