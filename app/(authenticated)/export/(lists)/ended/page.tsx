import { EndedShares } from '@/components/export/ended-shares'
import { ShareListAccess, ShareTabFrame } from '@/components/export/share-tab-frame'
import { exportConfig, exportReadiness } from '@/lib/export/config'
import { fetchShareRight } from '@/lib/export/share-permission'
import { requireSession } from '@/lib/session'

/**
 * „Beendet“ (/export/ended): what was withdrawn, not accepted, removed or
 * taken out of the catalogue, from GitLab's record (plan of 2026-10-18,
 * section 6). Nothing of it is kept by the marketplace.
 */
export default async function EndedPage() {
    await requireSession()
    const readiness = exportReadiness(exportConfig())
    const right = readiness === 'ready' ? await fetchShareRight() : undefined
    const canList = readiness === 'ready' && right === 'allowed'

    return (
        <ShareTabFrame tab="ended" enabled={canList}>
            {canList ? <EndedShares /> : <ShareListAccess tab="ended" readiness={readiness} right={right} />}
        </ShareTabFrame>
    )
}
