'use server'

import { listSimulations, switchSimulation, SimulatorError, type SimulationStatus } from '@/lib/simulator/client'
import { streamsOfInstallation, type InstallationStream } from '@/lib/simulator/registration'
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
