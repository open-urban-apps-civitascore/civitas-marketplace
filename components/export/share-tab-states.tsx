import Link from 'next/link'

import { EmptyState } from '@/components/ui/layout'
import { DECLINE_DAYS } from '@/lib/export/declines'
import type { ShareTab } from '@/lib/export/share-tabs'
import { WIZARD_PATH } from '@/lib/export/wizard-address'

// No hooks and no server code: pages, lists and tests render these alike.

export const TAB_LEADS: Record<ShareTab, string> = {
    'in-progress':
        'Was angefangen oder eingereicht ist und noch nicht im Katalog steht. Bei jedem Eintrag steht, wer gerade dran ist. ' +
        `Was das Katalog-Team nicht angenommen hat, bleibt hier ${DECLINE_DAYS} Tage lang und steht von Anfang an auch unter „Beendet“.`,
    published: 'Was aus dieser Instanz im Katalog steht - beide Prüfungen sind durch. Herausnehmen kann einen Eintrag nur das Katalog-Team.',
    ended: 'Was zurückgezogen, nicht angenommen, entfernt oder aus dem Katalog genommen wurde, mit Datum und Namen. Die Angaben kommen aus GitLab, dort bleibt alles erhalten.',
}

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

/** Shares from other instances through the same account (demo, dev and local share one). */
export function elsewhereLine(count: number): string {
    return count === 1 ? '1 weiterer Eintrag stammt von einer anderen Instanz.' : `${count} weitere Einträge stammen von anderen Instanzen.`
}

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
