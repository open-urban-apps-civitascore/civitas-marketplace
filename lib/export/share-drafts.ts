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
 *
 * Saved only once the person reached the Steckbrief: choosing a dataset and
 * looking at what goes into the package is no started share yet (plan of
 * 2026-10-18, section 3).
 */

const PREFIX = 'marketplace.share-draft.v1:'

/**
 * How many steps the wizard has, stored with every draft since it has three
 * (rc.5). Drafts from the four-step wizard carry none: they counted „Bestand
 * prüfen“ as a step of its own, so their step reads one lower. They keep their
 * key and are never rewritten for it, so a draft cannot get lost in between.
 */
const WIZARD_STEPS = 3

export interface ShareDraft {
    datasetId: string
    /** The dataset's name when the draft was saved, for a list where the dataset may be gone. */
    datasetName: string
    /** ISO timestamp of the last save. */
    savedAt: string
    /** ISO timestamp of the first save, for „Angefangen am“. Drafts saved before rc.5 have none (see `draftStart`). */
    startedAt?: string
    /** The step to come back to: „Auswählen“ with the package contents (1), or the Steckbrief (2). */
    step: 1 | 2
    /** The form's basic fields (name, description, version, …). */
    basics: Record<string, string>
    metadata: MetadataDraft
    targetKey: string
    /** Demo streams unticked under the package contents. */
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

/** Whose drafts these are, as a tag; none without e-mail or name, and then no drafts are kept at all. */
export function draftOwnerOf(user: { email?: string | null; name?: string | null } | undefined): string | undefined {
    const owner = user?.email?.trim() || user?.name?.trim()
    return owner ? draftOwnerTag(owner) : undefined
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

const isTimestamp = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value))

/** The step a stored draft comes back to, in today's numbering; undefined for a step no wizard had. */
function storedStep(steps: unknown, step: unknown): ShareDraft['step'] | undefined {
    if (steps === WIZARD_STEPS) return step === 1 || step === 2 ? step : undefined
    // The four-step wizard: 2 was the inventory, now part of „Auswählen“, and 3 the Steckbrief.
    if (steps === undefined) return step === 2 ? 1 : step === 3 ? 2 : undefined
    return undefined
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
    const { steps, ...draft } = value as Record<string, unknown>
    const step = storedStep(steps, draft.step)
    if (
        typeof draft.datasetId !== 'string' ||
        typeof draft.datasetName !== 'string' ||
        !isTimestamp(draft.savedAt) ||
        (draft.startedAt !== undefined && !isTimestamp(draft.startedAt)) ||
        step === undefined ||
        !isRecordOfStrings(draft.basics) ||
        !isMetadataDraft(draft.metadata) ||
        typeof draft.targetKey !== 'string' ||
        !isStringArray(draft.demoExcluded)
    ) {
        return undefined
    }
    return { ...draft, step } as unknown as ShareDraft
}

/**
 * The step a draft saved now comes back to, or none: „Auswählen“ alone starts
 * no draft, it only keeps one up to date that exists already - an older draft
 * continued there, or one the person went back to from the Steckbrief.
 * The preview is not saved as a step: it is made again from the Steckbrief.
 */
export function draftStepAt(step: number, hasDraft: boolean): ShareDraft['step'] | undefined {
    if (step >= 2) return 2
    return hasDraft ? 1 : undefined
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
        storage.setItem(draftKey(ownerTag, draft.datasetId), JSON.stringify({ ...draft, steps: WIZARD_STEPS }))
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

const STARTED_ON = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' })

/** When a share was started; a draft from before rc.5 knows only its last save, which is the closest there is. */
export function draftStart(draft: Pick<ShareDraft, 'savedAt' | 'startedAt'>): string {
    return draft.startedAt ?? draft.savedAt
}

/** "12.10.", the day a share was started, for „Angefangen am 12.10.“. */
export function draftStartedOn(draft: Pick<ShareDraft, 'savedAt' | 'startedAt'>): string {
    return STARTED_ON.format(new Date(draftStart(draft)))
}
