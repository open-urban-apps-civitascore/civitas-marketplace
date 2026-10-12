'use server'

import { revalidatePath } from 'next/cache'

import { proposalSchema, proposalToEntry } from '@/lib/assistant/proposal'
import { fetchCanCreateDatapool, fetchDatapools, type DatapoolOption } from '@/lib/datapools'
import type { InstallResult } from '@/lib/install-actions'
import {
    InstallPayloadError,
    buildInstallationRequest,
    describeInstallFailure,
    summarizeInstallation,
    type InstallationRequest,
    type InstallationReceipt,
} from '@/lib/install-payload'
import { getAccessToken, requireSession } from '@/lib/session'
import { isSimulatorConfigured } from '@/lib/simulator/client'

/**
 * The two things the assistant's chat asks the server for besides the
 * conversation itself (which streams through /api/assistant): the inputs of
 * the install dialog, and the install of a structure on its own.
 */

/** What the install dialog needs besides the entry, read with the user's token. */
export interface InstallOptions {
    datapools: DatapoolOption[]
    datapoolProblem?: string
    canCreateDatapool: boolean
    demoAvailable: boolean
}

/** Datapools, the right to create one, and whether demo data can run: the install dialog's inputs. */
export async function loadInstallOptions(): Promise<InstallOptions> {
    await requireSession()
    const [listing, canCreateDatapool] = await Promise.all([fetchDatapools(), fetchCanCreateDatapool()])
    return {
        datapools: listing.pools,
        datapoolProblem: listing.problem,
        canCreateDatapool,
        demoAvailable: isSimulatorConfigured(),
    }
}

/**
 * Installs a confirmed structure proposal through the same path as a catalogue
 * package: the proposal becomes a catalogue entry, the entry an installation
 * request, and the request goes to `POST /v1/installations` with the user's
 * token. The platform checks the user's rights and journals it as usual.
 */
export async function installProposal(raw: unknown): Promise<InstallResult> {
    await requireSession()
    const parsed = proposalSchema.safeParse(raw)
    if (!parsed.success) return { status: 'invalid', detail: 'Vorschlag ungültig.', httpStatus: 0 }

    const entry = proposalToEntry(parsed.data)
    let request: InstallationRequest
    try {
        request = buildInstallationRequest(entry)
    } catch (error) {
        if (!(error instanceof InstallPayloadError)) throw error
        return { status: 'error', detail: `Paket nicht installierbar: ${error.message}`, httpStatus: 0 }
    }

    const response = await fetch(`${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/installations`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${await getAccessToken()}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        cache: 'no-store',
    })
    if (response.status !== 201) {
        const failure = describeInstallFailure(
            response.status,
            response.statusText,
            await response.text().catch(() => ''),
        )
        return { ...failure, httpStatus: response.status }
    }

    const receipt = (await response.json()) as InstallationReceipt
    revalidatePath('/datastructures')
    revalidatePath('/installed')
    const installation = receipt.id ? ` · Installation ${receipt.id}` : ''
    return {
        status: 'created',
        detail: `${summarizeInstallation(receipt, entry.manifest.displayName)}${installation}`,
        httpStatus: 201,
        installationId: receipt.id,
    }
}
