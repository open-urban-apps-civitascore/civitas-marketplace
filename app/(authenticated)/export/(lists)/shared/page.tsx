import { PublishedShares } from '@/components/export/published-shares'
import { ShareListAccess, ShareTabFrame } from '@/components/export/share-tab-frame'
import { exportConfig, exportReadiness } from '@/lib/export/config'
import { fetchShareRight } from '@/lib/export/share-permission'
import { requireSession } from '@/lib/session'

// „Veröffentlicht“ keeps the address /export/shared, so old links keep working.
export default async function PublishedPage() {
    await requireSession()
    const readiness = exportReadiness(exportConfig())
    const right = readiness === 'ready' ? await fetchShareRight() : undefined
    const canList = readiness === 'ready' && right === 'allowed'

    return (
        <ShareTabFrame tab="published" enabled={canList}>
            {canList ? <PublishedShares /> : <ShareListAccess tab="published" readiness={readiness} right={right} />}
        </ShareTabFrame>
    )
}
