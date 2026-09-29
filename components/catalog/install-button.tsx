'use client'

import { useActionState } from 'react'
import { Download } from 'lucide-react'

import { SubmitButton } from '@/components/catalog/submit-button'
import { installEntry, type InstallResult } from '@/lib/install-actions'

/** Shared with the install dialog, so the two install surfaces read identically. */
export const FEEDBACK_STYLES: Record<InstallResult['status'], string> = {
    created: 'text-success',
    conflict: 'text-warn',
    invalid: 'text-error',
    error: 'text-error',
}

export function feedbackText(result: InstallResult): string {
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

export function InstallButton({
    entryId,
    installed = false,
}: {
    entryId: string
    /** Already present in this instance — the action is then closed. */
    installed?: boolean
}) {
    const [result, formAction, pending] = useActionState(installEntry, null)
    // Also latch on a fresh success, so the button closes immediately instead of
    // waiting for the revalidated page to arrive.
    const done = installed || result?.status === 'created'

    return (
        <div className="flex flex-col gap-2">
            <form action={formAction}>
                <input type="hidden" name="entryId" value={entryId} />
                <SubmitButton
                    pending={pending}
                    icon={Download}
                    label="Installieren"
                    pendingLabel="Installiere …"
                    disabled={done}
                />
            </form>
            {result && (
                <p className={`text-xs leading-relaxed ${FEEDBACK_STYLES[result.status]}`}>
                    {feedbackText(result)}
                </p>
            )}
        </div>
    )
}
