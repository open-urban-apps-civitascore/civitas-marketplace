'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { useShareDrafts } from '@/components/export/use-share-drafts'
import { useSharedListing } from '@/components/export/use-shared-listing'
import type { SharedPackageRow } from '@/lib/export/share-listing'
import { shareTabs } from '@/lib/export/share-tabs'

/** The rows of a person who may not see what was submitted: one list, so the tab rules are not worked out anew on every render. */
const NONE: SharedPackageRow[] = []

interface ShareListingContextValue {
    listing: ReturnType<typeof useSharedListing>
    /** Whether a list or the tab bar asked for the listing during this visit. */
    wanted: boolean
    want: () => void
    person?: string
    draftOwner?: string
}

const ShareListingContext = createContext<ShareListingContextValue | null>(null)

/**
 * The one reading of what was shared, for every page of "Teilen" (plan of
 * 2026-10-18, section 2): it sits in the layout of /export, which stays
 * mounted from tab to tab and into the wizard and back, so GitLab is asked
 * once per visit, again on „Aktualisieren“ and after each write.
 *
 * It reads only once something on the page asks (`useShareView` with the
 * right to see it): the wizard alone shows nothing of it, and a person
 * without the right would only be refused. Who may see it is each page's own
 * check - layouts do not run again on navigation.
 */
export function ShareListingProvider({
    person,
    draftOwner,
    children,
}: {
    /** Who is looking, by the name proposals are made for (`proposerName`). */
    person?: string
    /** Whose drafts these are (`draftOwnerOf`). */
    draftOwner?: string
    children: ReactNode
}) {
    const [wanted, setWanted] = useState(false)
    const listing = useSharedListing(wanted)
    const want = useCallback(() => setWanted(true), [])
    const value = useMemo(() => ({ listing, wanted, want, person, draftOwner }), [listing, wanted, want, person, draftOwner])
    return <ShareListingContext value={value}>{children}</ShareListingContext>
}

function useShareListingContext(): ShareListingContextValue {
    const value = useContext(ShareListingContext)
    if (!value) throw new Error('The share pages read their listing through ShareListingProvider (app/(authenticated)/export/layout.tsx).')
    return value
}

/**
 * The listing as a list, the tab bar or „So läuft Teilen ab“ uses it, with
 * the person's started shares and the tab rules applied (`share-tabs.ts`).
 * `enabled`: this person may see what was submitted here; without it the
 * rows are empty and only the started shares count.
 *
 * `rows` is null until the first reading came back - "not read yet", never
 * "nothing shared"; `draftsReady` is false until the browser was read.
 */
export function useShareView(enabled: boolean) {
    const { listing, wanted, want, person, draftOwner } = useShareListingContext()
    useEffect(() => {
        if (enabled) want()
    }, [enabled, want])
    const { drafts, ready: draftsReady, discard: discardDraft } = useShareDrafts(draftOwner)
    const rows = enabled ? (wanted ? listing.rows : null) : NONE
    const tabs = useMemo(
        () => shareTabs(rows ?? [], { instance: listing.instance, person, drafts: drafts.length }),
        [rows, listing.instance, person, drafts.length],
    )
    return {
        rows,
        tabs,
        drafts,
        draftsReady,
        discardDraft,
        error: enabled ? listing.error : undefined,
        loaded: listing.loaded,
        pending: enabled && (!wanted || listing.pending),
        readAt: enabled ? listing.readAt : undefined,
        reload: listing.reload,
    }
}

/** Reads the listing again after a write, for whoever shows it next; nothing is read while nobody asked for it. */
export function useShareListingReload(): () => void {
    return useShareListingContext().listing.reload
}
