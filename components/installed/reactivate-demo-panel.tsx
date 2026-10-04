'use client'

import { useActionState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'

import { reactivateDemoStreams, type ReactivateResult } from '@/lib/simulator-actions'

function feedbackText(result: ReactivateResult): string {
    const failures = (result.failed ?? [])
        .map(({ streamName, detail }) => `${streamName} (${detail})`)
        .join(', ')
    switch (result.status) {
        case 'ok':
            return `${result.registered} Stream(s) reaktiviert.`
        case 'partial':
            return `${result.registered} Stream(s) reaktiviert, fehlgeschlagen: ${failures} — erneut versuchen registriert nur die fehlenden nach.`
        default:
            return failures ? `Reaktivierung fehlgeschlagen: ${failures}` : `Reaktivierung fehlgeschlagen: ${result.detail}`
    }
}

/**
 * Takes the live panel's place when the registry holds no streams for an
 * installation whose package could have them — the state a simulator restart
 * leaves behind (the registry is in-memory by design). One click recomputes
 * the streams from the catalogue entry and re-registers them; on success the
 * page re-renders and the live panel returns.
 */
export function ReactivateDemoPanel({
    installationId,
    catalogEntryId,
}: {
    installationId: string
    catalogEntryId: string
}) {
    const [result, formAction, pending] = useActionState(reactivateDemoStreams, null)

    return (
        <div className="border-b bg-muted/20 px-4 py-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-xs font-medium text-foreground">Demo-Daten</span>
                <span className="text-xs text-muted-foreground">
                    Keine Streams registriert — Simulator neu gestartet?
                </span>
                <form action={formAction} className="ml-auto">
                    <input type="hidden" name="installationId" value={installationId} />
                    <input type="hidden" name="catalogEntryId" value={catalogEntryId} />
                    <button
                        type="submit"
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
                    >
                        {pending ? (
                            <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                            <RefreshCw className="size-3.5" />
                        )}
                        {pending ? 'Reaktiviere …' : 'Demo-Daten reaktivieren'}
                    </button>
                </form>
            </div>
            {result && (
                <p
                    className={`mt-1 text-xs ${result.status === 'ok' ? 'text-success' : 'text-error'}`}
                >
                    {feedbackText(result)}
                </p>
            )}
        </div>
    )
}
