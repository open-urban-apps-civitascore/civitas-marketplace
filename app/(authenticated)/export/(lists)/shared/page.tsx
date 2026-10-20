import { SharedPackages } from '@/components/export/shared-packages'
import { ShareListAccess, ShareTabFrame } from '@/components/export/share-tab-frame'
import { exportConfig, exportReadiness } from '@/lib/export/config'
import { fetchShareRight } from '@/lib/export/share-permission'
import { requireSession } from '@/lib/session'

/**
 * „Veröffentlicht“ (/export/shared, the address of the former "Geteilte
 * Pakete", so old links keep working): what this instance put into the
 * catalogue through this marketplace (plan of 2026-10-18, section 5).
 */
export default async function PublishedPage() {
    await requireSession()
    const readiness = exportReadiness(exportConfig())
    const right = readiness === 'ready' ? await fetchShareRight() : undefined
    const canList = readiness === 'ready' && right === 'allowed'

    return (
        <ShareTabFrame tab="published" enabled={canList}>
            {canList ? <SharedPackages /> : <ShareListAccess tab="published" readiness={readiness} right={right} />}
        </ShareTabFrame>
    )
}
