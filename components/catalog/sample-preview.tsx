'use client'

import { useId, useRef, useState, useTransition } from 'react'
import { FlaskConical, Loader2, X } from 'lucide-react'

import { fetchSamplePreview, type SamplePreviewResult } from '@/lib/preview-actions'

/** Preview the simulator's sample records from a use-case detail page. */
export function SamplePreview({ entryId, displayName }: { entryId: string; displayName: string }) {
    const dialogRef = useRef<HTMLDialogElement>(null)
    const titleId = useId()
    const [result, setResult] = useState<SamplePreviewResult | null>(null)
    const [pending, startTransition] = useTransition()

    function load() {
        dialogRef.current?.showModal()
        if (pending) return
        setResult(null)
        startTransition(async () => {
            try {
                setResult(await fetchSamplePreview(entryId))
            } catch {
                setResult({ status: 'error', detail: 'Beispieldaten konnten nicht geladen werden. Bitte erneut versuchen.' })
            }
        })
    }

    return (
        <>
            <button
                type="button"
                onClick={load}
                aria-haspopup="dialog"
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
                <FlaskConical className="size-4" />
                Beispieldaten
            </button>

            <dialog
                ref={dialogRef}
                aria-labelledby={titleId}
                className="m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-3xl overflow-hidden rounded-lg border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/40"
                onClick={(event) => {
                    if (event.target === event.currentTarget) dialogRef.current?.close()
                }}
            >
                <div className="flex max-h-[85vh] flex-col">
                    <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
                        <div>
                            <h2 id={titleId} className="text-lg font-semibold">Beispieldaten</h2>
                            <p className="mt-1 text-sm text-muted-foreground">{displayName}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => dialogRef.current?.close()}
                            aria-label="Schließen"
                            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted"
                        >
                            <X className="size-5" />
                        </button>
                    </div>

                    <div className="min-h-0 overflow-auto p-5" aria-busy={pending}>
                        {pending ? (
                            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="size-4 animate-spin" />
                                Beispieldaten werden geladen …
                            </p>
                        ) : result?.status === 'ok' && result.records?.length ? (
                            <>
                                <p className="mb-3 text-sm text-muted-foreground">
                                    Nachrichten, wie sie die Station „{result.streamName}“ senden würde:
                                </p>
                                <pre className="overflow-x-auto rounded-md border bg-muted/40 p-4 font-mono text-xs leading-relaxed">
                                    {JSON.stringify(result.records, null, 2)}
                                </pre>
                            </>
                        ) : result ? (
                            <div role={result.status === 'error' ? 'alert' : 'status'}>
                                <p className={`text-sm ${result.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                                    {result.detail ?? 'Für diesen Anwendungsfall sind keine Beispieldaten verfügbar.'}
                                </p>
                                {result.status === 'error' && (
                                    <button type="button" onClick={load} className="mt-3 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">
                                        Erneut versuchen
                                    </button>
                                )}
                            </div>
                        ) : null}
                    </div>
                </div>
            </dialog>
        </>
    )
}
