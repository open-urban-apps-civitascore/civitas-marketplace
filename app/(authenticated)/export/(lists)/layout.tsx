import Link from 'next/link'
import { PackagePlus } from 'lucide-react'

import { ShareProcess } from '@/components/export/share-process'
import { ShareTabsBar } from '@/components/export/share-tabs-nav'
import { buttonClass } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/layout'
import { exportConfig, exportReadiness } from '@/lib/export/config'
import { fetchShareRight } from '@/lib/export/share-permission'
import { WIZARD_PATH } from '@/lib/export/wizard-address'
import { requireSession } from '@/lib/session'

/**
 * The page "Teilen" with its three tabs, „In Arbeit · Veröffentlicht ·
 * Beendet“ (decisions of 18.10.): the overview, not a dashboard of its own.
 * Top to bottom: the heading, the line „Was diese Instanz teilt“ and the
 * page's one primary button „Neues Paket teilen“; the tab bar, always in the
 * same place; „So läuft Teilen ab“ under it, so the tabs never move when it
 * opens or folds; then the tab's own page.
 *
 * The right is read here for the tab bar's counts only. The layout is not
 * rendered again on navigation between the tabs, so each tab's page checks
 * the session and the right itself.
 */
export default async function ShareListsLayout({ children }: { children: React.ReactNode }) {
    await requireSession()
    const readiness = exportReadiness(exportConfig())
    const right = readiness === 'ready' ? await fetchShareRight() : undefined
    const canList = readiness === 'ready' && right === 'allowed'

    return (
        <div className="flex flex-col gap-6">
            <PageHeader
                title="Teilen"
                lead="Was diese Instanz teilt"
                actions={
                    <Link href={WIZARD_PATH} className={`${buttonClass('primary')} h-10 px-4`}>
                        <PackagePlus aria-hidden className="size-4" />
                        Neues Paket teilen
                    </Link>
                }
            />
            <div className="flex flex-col gap-4">
                <ShareTabsBar enabled={canList} />
                <ShareProcess enabled={canList} />
            </div>
            {children}
        </div>
    )
}
