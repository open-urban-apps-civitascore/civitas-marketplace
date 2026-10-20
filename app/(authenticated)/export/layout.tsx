import { ShareListingProvider } from '@/components/export/share-listing-provider'
import { draftOwnerOf } from '@/lib/export/share-drafts'
import { requireSession } from '@/lib/session'

/**
 * Around every page of "Teilen" - the three lists and the wizard: the one
 * reading of what was shared (`ShareListingProvider`). A layout stays
 * mounted while the person moves between its pages, so GitLab is asked once
 * per visit, not once per tab.
 *
 * The session read here only names the person for the lists; it is not the
 * guard. Layouts do not render again on navigation, so each page checks the
 * session and the right to share itself.
 */
export default async function ShareLayout({ children }: { children: React.ReactNode }) {
    const session = await requireSession()
    return (
        // The display name, as proposals are made for it: "du bist dran" only for one's own (plan, section 4).
        <ShareListingProvider person={session.user?.name?.trim() || undefined} draftOwner={draftOwnerOf(session.user)}>
            {children}
        </ShareListingProvider>
    )
}
