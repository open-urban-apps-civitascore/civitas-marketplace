import Link from 'next/link'

import { SharedPackages } from '@/components/export/shared-packages'
import { PageHeader } from '@/components/ui/layout'
import { Notice } from '@/components/ui/notice'
import { exportConfig, exportReadiness } from '@/lib/export/config'
import { fetchShareRight, LISTING_HIDDEN_BECAUSE } from '@/lib/export/share-permission'
import { requireSession } from '@/lib/session'

/**
 * Everything shared through this marketplace, on a page of its own (Ewa,
 * 2026-10-13). At the foot of the share page the list was always open and
 * asked GitLab several questions per package on every visit, also when
 * someone only wanted to share something new. Here it loads when wanted, and
 * it is the place to come back to after a merge, days later.
 */
export default async function SharedPackagesPage() {
    await requireSession()
    const readiness = exportReadiness(exportConfig())
    const right = readiness === 'ready' ? await fetchShareRight() : undefined

    return (
        <div className="flex flex-col gap-6">
            <PageHeader
                title="Geteilte Pakete"
                lead="Was über diesen Marktplatz geteilt wurde, neueste zuerst. Ist ein Paket angenommen, geht es hier weiter - ohne den Steckbrief erneut auszufüllen."
                actions={
                    <Link href="/export" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                        Neu teilen
                    </Link>
                }
            />

            {readiness !== 'ready' ? (
                <Notice tone="neutral" title="Teilen ist auf dieser Instanz noch nicht eingerichtet">
                    Deshalb gibt es hier noch nichts zu sehen. Das Einrichten übernimmt der Betrieb.
                </Notice>
            ) : right !== 'allowed' ? (
                <Notice tone="neutral">{LISTING_HIDDEN_BECAUSE[right ?? 'unknown']}</Notice>
            ) : (
                <SharedPackages />
            )}
        </div>
    )
}
