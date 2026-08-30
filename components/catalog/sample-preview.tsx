'use client'

import { useState, useTransition } from 'react'
import { FlaskConical, Loader2, X } from 'lucide-react'

import { fetchSamplePreview, type SamplePreviewResult } from '@/lib/preview-actions'

/**
 * "Beispieldaten ansehen" on a use-case card: renders the bundled demo
 * scenario through the simulator's side-effect-free /sample endpoint, so the
 * shape question — what does this use case's data look like? — is answered
 * before anything is installed. Records arrive as the raw device-format
 * messages the simulator would publish, shown verbatim: that honesty IS the
 * preview.
 */
export function SamplePreview({ entryId }: { entryId: string }) {
    const [result, setResult] = useState<SamplePreviewResult | null>(null)
    const [open, setOpen] = useState(false)
    const [pending, startTransition] = useTransition()

    function load() {
        setOpen(true)
        startTransition(async () => {
            setResult(await fetchSamplePreview(entryId))
        })
    }

    return (
        <div className="flex flex-col gap-2">
            <button
                type="button"
                onClick={open ? () => setOpen(false) : load}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
                {pending ? <Loader2 className="size-4 animate-spin" /> : open ? <X className="size-4" /> : <FlaskConical className="size-4" />}
                {open ? 'Vorschau schließen' : 'Beispieldaten'}
            </button>

            {open && result && (
                <div className="rounded-md border bg-card p-3 text-xs">
                    {result.status === 'ok' && result.records ? (
                        <>
                            <p className="mb-2 font-medium text-muted-foreground">
                                Nachrichten, wie sie die Station „{result.streamName}&ldquo; senden würde:
                            </p>
                            <div className="max-h-56 overflow-auto">
                                <pre className="whitespace-pre-wrap break-all font-mono leading-relaxed">
                                    {result.records
                                        .map((record) => JSON.stringify(record, null, 1))
                                        .join('\n')}
                                </pre>
                            </div>
                        </>
                    ) : (
                        <p className={result.status === 'error' ? 'text-error' : 'text-muted-foreground'}>
                            {result.detail}
                        </p>
                    )}
                </div>
            )}
        </div>
    )
}
