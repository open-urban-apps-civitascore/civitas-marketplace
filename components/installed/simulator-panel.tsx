'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Loader2, Pause, Play } from 'lucide-react'

import { fetchInstallationSimulations, toggleSimulation } from '@/lib/simulator-actions'
import type { InstallationStream } from '@/lib/simulator/registration'
import type { SimulationStatus } from '@/lib/simulator/client'

/** Registry polling cadence while the panel is open. */
const POLL_INTERVAL_MS = 5000

const timeFormat = new Intl.DateTimeFormat('de-DE', {
    timeStyle: 'medium',
    timeZone: 'Europe/Berlin',
})

/**
 * Live control over the demo-data streams the install registered: per stream
 * an on/off toggle and the last message the simulator actually published.
 * Polls the simulator registry while open — `lastPayload` there is real
 * broker traffic, so this doubles as the "is data flowing?" check without a
 * broker subscription. Rendered only when the server found streams for this
 * installation, so an empty panel never appears.
 */
export function SimulatorPanel({
    installationId,
    initialStreams,
}: {
    installationId: string
    initialStreams: InstallationStream[]
}) {
    const [open, setOpen] = useState(false)
    const [streams, setStreams] = useState(initialStreams)
    const [pollError, setPollError] = useState<string | null>(null)
    const [togglingId, setTogglingId] = useState<string | null>(null)
    const [toggleError, setToggleError] = useState<string | null>(null)
    const inFlight = useRef(false)

    const refresh = useCallback(async () => {
        if (inFlight.current) return
        inFlight.current = true
        try {
            const result = await fetchInstallationSimulations(installationId)
            if (result.status === 'ok' && result.streams) {
                setStreams(result.streams)
                setPollError(null)
            } else {
                // Keep the last known rows — a poll hiccup should not blank the panel.
                setPollError(result.detail ?? 'Simulator nicht erreichbar')
            }
        } finally {
            inFlight.current = false
        }
    }, [installationId])

    useEffect(() => {
        if (!open) return
        void refresh()
        const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS)
        return () => clearInterval(timer)
    }, [open, refresh])

    async function onToggle(stream: SimulationStatus) {
        setTogglingId(stream.id)
        setToggleError(null)
        try {
            const result = await toggleSimulation(stream.id, !stream.enabled)
            if (result.status === 'ok' && result.stream) {
                const refreshed = result.stream
                setStreams((current) =>
                    current.map((row) =>
                        row.status.id === refreshed.id ? { ...row, status: refreshed } : row,
                    ),
                )
            } else {
                setToggleError(result.detail ?? 'Umschalten fehlgeschlagen')
            }
        } finally {
            setTogglingId(null)
        }
    }

    const active = streams.filter((row) => row.status.enabled).length

    return (
        <div className="border-b bg-muted/20">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50"
            >
                <ChevronRight className={`size-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
                <span className="font-medium text-foreground">Demo-Daten</span>
                <span>
                    {streams.length} Stream{streams.length === 1 ? '' : 's'} · {active} aktiv
                </span>
            </button>

            {open && (
                <div className="flex flex-col gap-2 px-4 pb-3">
                    {(pollError ?? toggleError) && (
                        <p className="text-xs text-error">{pollError ?? toggleError}</p>
                    )}
                    {streams.map(({ streamName, status }) => (
                        <div
                            key={status.id}
                            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card px-3 py-2"
                        >
                            <span className="text-sm font-medium text-foreground">{streamName}</span>
                            <span
                                className={
                                    status.enabled
                                        ? 'rounded bg-success/10 dark:bg-success/20 px-1.5 py-0.5 text-xs text-success'
                                        : 'rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'
                                }
                            >
                                {status.enabled ? 'Aktiv' : 'Pausiert'}
                            </span>
                            <span className="break-all text-xs text-muted-foreground">
                                {status.topic} · alle {status.intervalSeconds}s
                            </span>
                            <button
                                type="button"
                                onClick={() => void onToggle(status)}
                                disabled={togglingId === status.id}
                                className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
                            >
                                {togglingId === status.id ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                ) : status.enabled ? (
                                    <Pause className="size-3.5" />
                                ) : (
                                    <Play className="size-3.5" />
                                )}
                                {status.enabled ? 'Stoppen' : 'Starten'}
                            </button>

                            <div className="w-full text-xs text-muted-foreground">
                                {status.lastError ? (
                                    <span className="text-error">Fehler: {status.lastError}</span>
                                ) : status.lastPayload ? (
                                    <>
                                        <span>
                                            {status.publishedCount} publiziert
                                            {status.lastPublishedAt &&
                                                ` · zuletzt ${timeFormat.format(new Date(status.lastPublishedAt))}`}
                                        </span>
                                        <code
                                            title={JSON.stringify(status.lastPayload)}
                                            className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap rounded bg-muted/60 px-1.5 py-0.5 font-mono"
                                        >
                                            {JSON.stringify(status.lastPayload)}
                                        </code>
                                    </>
                                ) : (
                                    <span>Noch nichts publiziert.</span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
