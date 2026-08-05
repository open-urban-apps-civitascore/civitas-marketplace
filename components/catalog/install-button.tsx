'use client'

import { useActionState } from 'react'
import { Download, Loader2 } from 'lucide-react'

import { installEntry, type InstallResult } from '@/lib/install-actions'

const FEEDBACK_STYLES: Record<InstallResult['status'], string> = {
    created: 'text-success',
    conflict: 'text-warn',
    invalid: 'text-error',
    error: 'text-error',
}

function feedbackText(result: InstallResult): string {
    switch (result.status) {
        case 'created':
            return `Installiert — ${result.detail}`
        case 'conflict':
            return `Bereits installiert: ${result.detail}`
        case 'invalid':
            return `Abgelehnt (400): ${result.detail}`
        default:
            return `Fehler (${result.httpStatus}): ${result.detail}`
    }
}

export function InstallButton({ entryId }: { entryId: string }) {
    const [result, formAction, pending] = useActionState(installEntry, null)

    return (
        <div className="flex flex-col gap-2">
            <form action={formAction}>
                <input type="hidden" name="entryId" value={entryId} />
                <button
                    type="submit"
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                    {pending ? (
                        <Loader2 className="size-4 animate-spin" />
                    ) : (
                        <Download className="size-4" />
                    )}
                    {pending ? 'Installiere …' : 'Installieren'}
                </button>
            </form>
            {result && (
                <p className={`text-xs leading-relaxed ${FEEDBACK_STYLES[result.status]}`}>
                    {feedbackText(result)}
                </p>
            )}
        </div>
    )
}
