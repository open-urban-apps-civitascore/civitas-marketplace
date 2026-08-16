'use client'

import { useActionState } from 'react'
import { Download } from 'lucide-react'

import { SubmitButton } from '@/components/catalog/submit-button'
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
                <SubmitButton
                    pending={pending}
                    icon={Download}
                    label="Installieren"
                    pendingLabel="Installiere …"
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
