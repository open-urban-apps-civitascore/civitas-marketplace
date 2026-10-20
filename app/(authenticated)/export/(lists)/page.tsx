import { InProgressTab } from '@/components/export/in-progress'
import { ShareListAccess, ShareTabFrame } from '@/components/export/share-tab-frame'
import { Notice } from '@/components/ui/notice'
import { exportConfig, exportReadiness } from '@/lib/export/config'
import { listDatasets } from '@/lib/export/portal-reader'
import { fetchShareRight } from '@/lib/export/share-permission'
import { getAccessToken, requireSession } from '@/lib/session'

/**
 * „In Arbeit“, the first tab and where the menu item "Teilen" leads (/export):
 * what was started or submitted and is not in the catalogue yet (plan of
 * 2026-10-18, section 4). The rows come from the share pages' one listing;
 * the started shares from this browser, so they show also where the person
 * may not see what was submitted.
 */
export default async function InProgressPage() {
    await requireSession()
    const config = exportConfig()
    const readiness = exportReadiness(config)
    const right = readiness === 'ready' ? await fetchShareRight() : undefined
    const canList = readiness === 'ready' && right === 'allowed'

    // To tell a started share whose dataset is gone, and to name the dataset a share came from; unread,
    // every started share can go on and the rows name no dataset.
    // The token outside the try block: a missing one redirects to the login by throwing, which must not be swallowed.
    const accessToken = await getAccessToken()
    let datasets: { id: string; name: string }[] | undefined
    try {
        datasets = (await listDatasets(accessToken)).map(({ id, name }) => ({ id, name }))
    } catch {
        datasets = undefined
    }

    return (
        <ShareTabFrame tab="in-progress" enabled={canList}>
            <ShareListAccess tab="in-progress" readiness={readiness} right={right} />
            {/* Once for the page, not on every row that waits for it. */}
            {canList && !config.catalog && (
                <Notice tone="neutral">Der Katalog ist auf dieser Instanz noch nicht eingerichtet - das richtet der Betrieb ein.</Notice>
            )}
            <InProgressTab enabled={canList} datasets={datasets} />
        </ShareTabFrame>
    )
}
