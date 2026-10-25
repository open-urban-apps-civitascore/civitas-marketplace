'use client'

import { useActionState } from 'react'
import { Loader2, MapPin } from 'lucide-react'

import { applyGeoportalConfig } from '@/lib/install-actions'

/**
 * Writes the use case's Masterportal entries into the geoportal (see applyGeoportalConfig): after
 * the release, or after someone removed them by hand. Safe to repeat: it replaces what it wrote
 * before.
 */
export function ApplyGeoportalButton({ installationId }: { installationId: string }) {
    const [result, formAction, pending] = useActionState(applyGeoportalConfig, null)

    return (
        <div className="flex flex-col items-start gap-1">
            <form action={formAction}>
                <input type="hidden" name="installationId" value={installationId} />
                <button
                    type="submit"
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
                >
                    {pending ? <Loader2 className="size-3.5 animate-spin" /> : <MapPin className="size-3.5" />}
                    {pending ? 'Trage ein …' : 'Im Geoportal eintragen'}
                </button>
            </form>
            {result && (
                <p
                    className={`text-xs leading-relaxed ${result.status === 'applied' ? 'text-success' : 'text-error'}`}
                >
                    {result.detail}
                </p>
            )}
        </div>
    )
}
