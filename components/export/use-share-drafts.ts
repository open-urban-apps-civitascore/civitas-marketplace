'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { readDrafts, removeDraft, writeDraft, type ShareDraft } from '@/lib/export/share-drafts'

/** Tells the other parts of this tab that a draft changed; the `storage` event only reaches other tabs. */
const CHANGED = 'marketplace:share-drafts'

function browserStorage(): Storage | undefined {
    try {
        return window.localStorage
    } catch {
        return undefined
    }
}

function subscribe(onChange: () => void): () => void {
    window.addEventListener('storage', onChange)
    window.addEventListener(CHANGED, onChange)
    return () => {
        window.removeEventListener('storage', onChange)
        window.removeEventListener(CHANGED, onChange)
    }
}

/**
 * Saving and deleting one person's drafts, without listening to them: what the
 * form needs, which would otherwise re-read every draft on each keystroke.
 *
 * Without an owner nothing is saved: with neither e-mail nor name to go by,
 * two people in one browser could not be kept apart.
 */
export function useShareDraftActions(ownerTag: string | undefined) {
    const save = useCallback(
        (draft: ShareDraft) => {
            if (!ownerTag) return false
            const saved = writeDraft(browserStorage(), ownerTag, draft)
            window.dispatchEvent(new Event(CHANGED))
            return saved
        },
        [ownerTag],
    )
    const discard = useCallback(
        (datasetId: string) => {
            if (!ownerTag) return
            removeDraft(browserStorage(), ownerTag, datasetId)
            window.dispatchEvent(new Event(CHANGED))
        },
        [ownerTag],
    )
    return { save, discard }
}

/**
 * One person's drafts of the "Teilen" form, live: saving in the editor updates
 * the list on the first step, and another tab's save arrives too. The server
 * knows no drafts, so the first render shows none and the browser fills them in.
 *
 * `ready` is false until the browser was read: on the server and while the
 * page hydrates. Whoever decides from the drafts - which step an address
 * opens, whether "In Arbeit" is empty - waits for it, or a reload would
 * start a fresh form before the saved one arrived.
 */
export function useShareDrafts(ownerTag: string | undefined) {
    // A string, so React can tell an unchanged list from a changed one by value; null before the browser was read.
    const snapshot = useSyncExternalStore<string | null>(
        subscribe,
        () => (ownerTag ? JSON.stringify(readDrafts(browserStorage(), ownerTag)) : '[]'),
        () => null,
    )
    const drafts = useMemo(() => (snapshot === null ? [] : (JSON.parse(snapshot) as ShareDraft[])), [snapshot])
    return { drafts, ready: snapshot !== null, ...useShareDraftActions(ownerTag) }
}
