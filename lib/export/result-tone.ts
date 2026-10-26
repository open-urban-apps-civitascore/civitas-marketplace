import type { ExportActionResult } from '@/lib/export-actions'
import type { NoticeTone } from '@/components/ui/notice'

/**
 * The tone of an action's answer, by the rules of `Notice`. Good news is never
 * amber: a merge request that is already open, or an entry the catalogue
 * already lists, is a fact, not a warning. A refused right or a missing setup
 * is nothing the person can fix here, so it is neutral too.
 */
export function resultTone(status: ExportActionResult['status']): NoticeTone {
    switch (status) {
        case 'ok':
        case 'unchanged':
            return 'success'
        case 'already-open':
        case 'not-merged':
        case 'unconfigured':
        case 'forbidden':
        // A "no" of the catalogue team: a fact, neither good news nor the person's mistake.
        case 'declined':
            return 'neutral'
        case 'invalid':
        case 'error':
            return 'error'
    }
}
