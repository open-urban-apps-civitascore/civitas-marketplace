'use server'

import { revalidatePath } from 'next/cache'

import { BundleError } from '@/lib/catalog/bundle'
import { resolveCatalogEntry } from '@/lib/catalog/source'
import { isDataStructureEntry } from '@/lib/catalog/types'
import {
    isSimulatorConfigured,
    listSimulations,
    registerSimulation,
    switchSimulation,
    SimulatorError,
    type SimulationStatus,
} from '@/lib/simulator/client'
import {
    planSimulations,
    registerPlanned,
    streamsOfInstallation,
    type InstallationStream,
} from '@/lib/simulator/registration'
import { requireSession } from '@/lib/session'

/**
 * Server actions behind the installed-page simulator panel. The panel polls
 * {@link fetchInstallationSimulations} while it is open — the simulator's
 * registry carries the last actually-published payload per stream, so polling
 * the registry IS the live view, no broker subscription needed.
 */

export interface SimulatorPanelResult {
    status: 'ok' | 'error'
    streams?: InstallationStream[]
    detail?: string
}

/** The installation's registered streams with their live publish state. */
export async function fetchInstallationSimulations(
    installationId: string,
): Promise<SimulatorPanelResult> {
    await requireSession()
    try {
        return { status: 'ok', streams: streamsOfInstallation(await listSimulations(), installationId) }
    } catch (error) {
        return {
            status: 'error',
            detail: error instanceof SimulatorError ? error.message : String(error),
        }
    }
}

export interface ToggleSimulationResult {
    status: 'ok' | 'error'
    stream?: SimulationStatus
    detail?: string
}

/** Pauses or resumes one stream; returns its refreshed state for an immediate UI update. */
export async function toggleSimulation(id: string, on: boolean): Promise<ToggleSimulationResult> {
    await requireSession()
    try {
        return { status: 'ok', stream: await switchSimulation(id, on) }
    } catch (error) {
        return {
            status: 'error',
            detail: error instanceof SimulatorError ? error.message : String(error),
        }
    }
}

export interface ReactivateResult {
    status: 'ok' | 'partial' | 'error'
    /** Streams now registered (idempotent PUTs — re-running converges). */
    registered?: number
    failed?: { streamName: string; detail: string }[]
    detail?: string
}

/**
 * Re-registers an installation's demo streams from its catalogue entry — the
 * marketplace half the simulator registry's docstring always promised: the
 * registry is deliberately in-memory, so a simulator restart forgets every
 * stream, and this action recomputes the desired set from the SOURCE (package
 * scenarios + datasource subscription + broker override) instead of replaying
 * any snapshot. Registration failures are collected per stream, not fatal —
 * the PUTs are idempotent, so clicking again converges.
 */
export async function reactivateDemoStreams(
    _prev: ReactivateResult | null,
    formData: FormData,
): Promise<ReactivateResult> {
    await requireSession()

    const installationId = formData.get('installationId')
    const catalogEntryId = formData.get('catalogEntryId')
    if (
        typeof installationId !== 'string' ||
        installationId.length === 0 ||
        typeof catalogEntryId !== 'string' ||
        catalogEntryId.length === 0
    ) {
        return { status: 'error', detail: 'installationId oder catalogEntryId fehlt' }
    }
    if (!isSimulatorConfigured()) {
        return { status: 'error', detail: 'SIMULATOR_API_URL ist nicht konfiguriert' }
    }

    let entry
    try {
        entry = await resolveCatalogEntry(catalogEntryId)
    } catch (error) {
        return {
            status: 'error',
            detail: `Paket-Quelle nicht verfügbar: ${
                error instanceof BundleError ? error.message : String(error)
            }`,
        }
    }
    if (!entry) {
        return { status: 'error', detail: `Unbekannter Katalog-Eintrag: ${catalogEntryId}` }
    }
    if (isDataStructureEntry(entry)) {
        return { status: 'error', detail: 'Dieses Paket bündelt keine Demo-Szenarien' }
    }

    let planned
    try {
        // Same broker resolution as the install path: the package's datasource
        // URL, overridden by SIMULATOR_BROKER_URL when the simulator lives
        // outside the docker network.
        planned = planSimulations(entry, installationId, process.env.SIMULATOR_BROKER_URL)
    } catch (error) {
        return { status: 'error', detail: error instanceof Error ? error.message : String(error) }
    }
    if (planned.length === 0) {
        return { status: 'error', detail: 'Dieses Paket bündelt keine Demo-Szenarien' }
    }

    const outcome = await registerPlanned(planned, installationId, registerSimulation)
    // The installed page re-reads the registry snapshot — a successful pass
    // replaces the reactivation row with the live panel.
    revalidatePath('/installed')

    if (outcome.failed.length === 0) {
        return { status: 'ok', registered: outcome.registered.length }
    }
    return {
        status: outcome.registered.length > 0 ? 'partial' : 'error',
        registered: outcome.registered.length,
        failed: outcome.failed,
    }
}
