'use client'

import { useActionState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'

import { reimportDashboards } from '@/lib/install-actions'

/**
 * Imports the dashboards of an installation again (see reimportDashboards):
 * after an import that failed, for an installation older than the Superset
 * configuration, or after a dashboard was deleted in Superset. Safe to repeat:
 * the import replaces what it created before.
 */
export function ReimportDashboardsButton({ installationId }: { installationId: string }) {
    const [result, formAction, pending] = useActionState(reimportDashboards, null)

    return (
        <div className="flex flex-col items-start gap-1">
            <form action={formAction}>
                <input type="hidden" name="installationId" value={installationId} />
                <button
                    type="submit"
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
                >
                    {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                    {pending ? 'Spiele ein …' : 'Dashboard erneut einspielen'}
                </button>
            </form>
            {result && (
                <p
                    className={`text-xs leading-relaxed ${result.status === 'imported' ? 'text-success' : 'text-error'}`}
                >
                    {result.detail}
                </p>
            )}
        </div>
    )
}
