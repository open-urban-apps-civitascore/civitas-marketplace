'use client'

import { useActionState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'

import { uninstallInstallation, type UninstallResult } from '@/lib/install-actions'

const FEEDBACK_STYLES: Record<UninstallResult['status'], string> = {
    uninstalled: 'text-success',
    conflict: 'text-warn',
    invalid: 'text-error',
    error: 'text-error',
}

function feedbackText(result: UninstallResult): string {
    switch (result.status) {
        case 'uninstalled': {
            // The action's detail is "Deinstalliert", then a remark per cleanup step (demo streams, Superset).
            const remarks = result.detail.replace(/^Deinstalliert/, '')
            return `Deinstalliert, alle angelegten Artefakte wurden entfernt.${remarks}`
        }
        case 'conflict':
            return `Noch in Verwendung (409): ${result.detail}`
        case 'invalid':
            return `Abgelehnt (400): ${result.detail}`
        default:
            return `Fehler (${result.httpStatus}): ${result.detail}`
    }
}

/**
 * Uninstalls an installation: the platform tears down everything it CREATED,
 * in reverse touch order, keeping artifacts other active installations still
 * reference. Released/provisioned datasets are refused by the backend with an
 * actionable message — the button shows it verbatim.
 *
 * `size`: 'sm' in the header of an installation card, 'md' next to the other
 * buttons of a use case's detail page.
 */
export function UninstallButton({
    installationId,
    size = 'sm',
}: {
    installationId: string
    size?: 'sm' | 'md'
}) {
    const [result, formAction, pending] = useActionState(uninstallInstallation, null)

    if (result?.status === 'uninstalled') {
        return <p className="text-xs text-success">{feedbackText(result)}</p>
    }

    const iconClass = size === 'md' ? 'size-4' : 'size-3.5'
    return (
        <div className={`flex flex-col gap-1 ${size === 'md' ? 'items-start' : 'items-end'}`}>
            <form
                action={formAction}
                onSubmit={(event) => {
                    // Native confirm keeps the destructive step deliberate without a dialog stack.
                    if (!window.confirm('Installation wirklich deinstallieren? Alle dabei angelegten Artefakte werden entfernt.')) {
                        event.preventDefault()
                    }
                }}
            >
                <input type="hidden" name="installationId" value={installationId} />
                <button
                    type="submit"
                    disabled={pending}
                    className={`inline-flex items-center gap-1.5 rounded-md border border-error/40 font-medium text-error transition-colors hover:bg-error/5 dark:hover:bg-error/20 disabled:opacity-50 ${size === 'md' ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-xs'}`}
                >
                    {pending ? (
                        <Loader2 className={`${iconClass} animate-spin`} />
                    ) : (
                        <Trash2 className={iconClass} />
                    )}
                    {pending ? 'Deinstalliere …' : 'Deinstallieren'}
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
