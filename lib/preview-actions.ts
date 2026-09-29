'use server'

import { resolveCatalogEntry } from '@/lib/catalog/source'
import { isDataStructureEntry } from '@/lib/catalog/types'
import { fetchSample, SimulatorError } from '@/lib/simulator/client'
import { requireSession } from '@/lib/session'

export interface SamplePreviewResult {
    status: 'ok' | 'none' | 'error'
    /** Which stream the records come from (its slug), for the dialog header. */
    streamName?: string
    records?: Record<string, unknown>[]
    detail?: string
}

/**
 * Renders a use case's bundled demo scenario through the simulator's
 * side-effect-free /sample endpoint — "what will this data look like?" answered
 * before anything is installed. Reads the FIRST stream of the first simulation:
 * the streams differ in constants and curve parameters, not in shape, so one
 * stream answers the shape question.
 */
export async function fetchSamplePreview(entryId: string): Promise<SamplePreviewResult> {
    await requireSession()

    let entry
    try {
        entry = await resolveCatalogEntry(entryId)
    } catch (error) {
        return { status: 'error', detail: `Katalog-Eintrag nicht ladbar: ${String(error)}` }
    }
    if (!entry || isDataStructureEntry(entry)) {
        return { status: 'none', detail: 'Dieser Eintrag hat keine Beispieldaten.' }
    }
    const simulation = entry.bundle.simulations[0]
    const stream = simulation?.streams[0]
    if (!simulation || !stream) {
        return { status: 'none', detail: 'Dieses Paket bringt kein Demo-Szenario mit.' }
    }

    try {
        const records = await fetchSample(
            { intervalSeconds: simulation.intervalSeconds, fields: stream.fields },
            5,
        )
        return { status: 'ok', streamName: stream.name, records }
    } catch (error) {
        const detail =
            error instanceof SimulatorError ? error.message : `Vorschau fehlgeschlagen: ${String(error)}`
        return { status: 'error', detail }
    }
}
