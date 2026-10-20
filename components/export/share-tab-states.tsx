import Link from 'next/link'

import { EmptyState } from '@/components/ui/layout'
import type { ShareTab } from '@/lib/export/share-tabs'
import { WIZARD_PATH } from '@/lib/export/wizard-address'

/**
 * What every tab of "Teilen" says of itself: its lead and its empty state
 * (plan of 2026-10-18, sections 4-6). No hooks and no server code, so the
 * pages and the lists render them alike and the tests read them as text.
 * Why a list stays hidden is told by the pages (`share-tab-frame.tsx`).
 */

/** What each tab holds, in one or two sentences under the tab bar. */
export const TAB_LEADS: Record<ShareTab, string> = {
    'in-progress': 'Was angefangen oder eingereicht ist und noch nicht im Katalog steht. Bei jedem Eintrag steht, wer gerade dran ist.',
    published: 'Was aus dieser Instanz im Katalog steht - beide Prüfungen sind durch. Herausnehmen kann einen Eintrag nur das Katalog-Team.',
    ended:
        'Was zurückgezogen, nicht angenommen oder entfernt wurde - mit wann und wer. Die Angaben kommen aus GitLab, dort bleibt alles erhalten. ' +
        'Was du nur angefangen und verworfen hast, steht hier nicht - es lag nur in deinem Browser.',
}

/** The tab names, for the heading screen readers find on each tab's page. */
export const TAB_TITLES: Record<ShareTab, string> = { 'in-progress': 'In Arbeit', published: 'Veröffentlicht', ended: 'Beendet' }

const EMPTY: Record<ShareTab, { title: string; body?: string; toWizard: boolean }> = {
    'in-progress': {
        title: 'Gerade ist nichts in Arbeit.',
        body: 'Was du anfängst oder einreichst, steht hier, bis es im Katalog ist.',
        toWizard: true,
    },
    published: {
        title: 'Von dieser Instanz steht noch nichts im Katalog.',
        body: 'Ein Paket kommt hierher, wenn beide Prüfungen durch sind - den Stand siehst du unter „In Arbeit“.',
        toWizard: true,
    },
    ended: { title: 'Noch nichts beendet.', toWizard: false },
}

/**
 * A tab with nothing in it. The way on is a link in the words of the page's
 * one primary button, „Neues Paket teilen“, and looks like text: the button
 * next to the heading stays the only primary (decision of 18.10.).
 */
export function EmptyTab({ tab }: { tab: ShareTab }) {
    const { title, body, toWizard } = EMPTY[tab]
    return (
        <EmptyState
            action={
                toWizard ? (
                    <Link href={WIZARD_PATH} className="font-medium text-primary underline-offset-2 hover:underline">
                        Neues Paket teilen
                    </Link>
                ) : undefined
            }
        >
            <span className="block font-medium text-foreground">{title}</span>
            {body && <span className="mt-1 block">{body}</span>}
        </EmptyState>
    )
}
