'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { useShareDrafts } from '@/components/export/use-share-drafts'
import { useSharedListing } from '@/components/export/use-shared-listing'
import type { SharedPackageRow } from '@/lib/export/share-listing'
import { shareTabs } from '@/lib/export/share-tabs'

/** One stable empty list, so the tab rules are not worked out anew on every render. */
const NONE: SharedPackageRow[] = []

interface ShareListingContextValue {
    listing: ReturnType<typeof useSharedListing>
    wanted: boolean
    want: () => void
    person?: string
    draftOwner?: string
}

const ShareListingContext = createContext<ShareListingContextValue | null>(null)

/**
 * Lives in the /export layout, which stays mounted across tabs and the wizard: GitLab is asked once per visit.
 * Reads only once a page asks; who may see it is each page's own check, as layouts do not rerun on navigation.
 */
export function ShareListingProvider({
    person,
    draftOwner,
    children,
}: {
    /** As `proposerName` gives it. */
    person?: string
    /** As `draftOwnerOf` gives it. */
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

/** `rows` is null until the first reading: "not read yet", never "nothing shared". */
export function useShareView(enabled: boolean) {
    const { listing, wanted, want, person, draftOwner } = useShareListingContext()
    useEffect(() => {
        if (enabled) want()
    }, [enabled, want])
    const { drafts, ready: draftsReady, discard: discardDraft } = useShareDrafts(draftOwner)
    const rows = enabled ? (wanted ? listing.rows : null) : NONE
    // A "no" is measured against the reading, so the lists change with a new one, never between two renders.
    const readAt = listing.readAt ? Date.parse(listing.readAt) : undefined
    const tabs = useMemo(
        () => shareTabs(rows ?? [], { instance: listing.instance, person, drafts: drafts.length, ...(readAt !== undefined ? { now: readAt } : {}) }),
        [rows, listing.instance, person, drafts.length, readAt],
    )
    return {
        rows,
        tabs,
        instance: listing.instance,
        older: enabled ? listing.older : undefined,
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

export function useShareListingReload(): () => void {
    return useShareListingContext().listing.reload
}
