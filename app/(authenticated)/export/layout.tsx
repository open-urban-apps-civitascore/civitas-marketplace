import { ShareListingProvider } from '@/components/export/share-listing-provider'
import { draftOwnerOf } from '@/lib/export/share-drafts'
import { proposerName } from '@/lib/export/share-permission'
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
        // The name proposals are made for, as the withdrawal dialog compares it: "du bist dran" only for one's own
        // (plan, section 4). Without a display name that is „unbekannt“, never anyone's name, so a colleague's row
        // still says whose move it is.
        <ShareListingProvider person={proposerName(session.user)} draftOwner={draftOwnerOf(session.user)}>
            {children}
        </ShareListingProvider>
    )
}
