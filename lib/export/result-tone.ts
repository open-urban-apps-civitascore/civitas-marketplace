import type { ExportActionResult } from '@/lib/export-actions'
import type { NoticeTone } from '@/components/ui/notice'

/** Facts and what the person cannot fix here are neutral, never amber. */
export function resultTone(status: ExportActionResult['status']): NoticeTone {
    switch (status) {
        case 'ok':
        case 'unchanged':
            return 'success'
        case 'already-open':
        case 'not-merged':
        case 'unconfigured':
        case 'forbidden':
        case 'declined':
            return 'neutral'
        case 'invalid':
        case 'error':
            return 'error'
    }
}
