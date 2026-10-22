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
            // Status 0: the request never reached the platform, so there is no code to show.
            return result.httpStatus
                ? `Fehler (${result.httpStatus}): ${result.detail}`
                : `Fehler: ${result.detail}`
    }
}

export function InstallButton({
    entryId,
    installed = false,
}: {
    entryId: string
    /** Already present in this instance: the card's badge then stands in for the button. */
    installed?: boolean
}) {
    const [result, formAction, pending] = useActionState(installEntry, null)
    // Also latch on a fresh success, so the button closes immediately instead of
    // waiting for the revalidated page to arrive.
    const done = installed || result?.status === 'created'

    // Installed: a disabled button would only repeat the badge. An install from
    // here re-renders the page as installed (revalidatePath) while this
    // component stays mounted, so its message stays readable.
    if (installed && !result) return null

    return (
        <div className="flex flex-col gap-2">
            {!done && (
                <form action={formAction}>
                    <input type="hidden" name="entryId" value={entryId} />
                    <SubmitButton
                        pending={pending}
                        icon={Download}
                        label="Installieren"
                        pendingLabel="Installiere …"
                    />
                </form>
            )}
            {/* The minted URN has almost no break opportunities. Unlike
                `break-words`, `wrap-anywhere` also lets the card's flex row
                shrink the line below the width of the URN. */}
            {result && (
                <p className={`text-xs leading-relaxed wrap-anywhere ${FEEDBACK_STYLES[result.status]}`}>
                    {feedbackText(result)}
                </p>
            )}
        </div>
    )
}
