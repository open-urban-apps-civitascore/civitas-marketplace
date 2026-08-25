'use server'

import { revalidatePath } from 'next/cache'

import { BundleError } from '@/lib/catalog/bundle'
import { resolveCatalogEntry } from '@/lib/catalog/source'
import { isDataStructureEntry, type CatalogEntry, type UseCaseEntry } from '@/lib/catalog/types'
import { applyDeclaredUrlOverride, clampDescription, versionProvenance } from '@/lib/install-payload'
import { getAccessToken } from '@/lib/session'
import {
    deleteSimulation,
    isSimulatorConfigured,
    listSimulationIds,
    registerSimulation,
} from '@/lib/simulator/client'
import { planSimulations, registerPlanned, simulationIdPrefix } from '@/lib/simulator/registration'

export interface InstallResult {
    status: 'created' | 'conflict' | 'invalid' | 'error'
    /** Human-readable summary (created) or backend message (ProblemDetail.detail). */
    detail: string
    httpStatus: number
}

interface DataSetImportSummary {
    installationId?: string
    dataSetId?: string
    dataSetName?: string
    dataStructures?: { name: string; urn: string; action: string }[]
    dataSources?: { name: string }[]
    mappings?: { name: string; urn: string; action: string }[]
    dataSinks?: { name: string; urn: string; action: string }[]
    pipelines?: { name: string; urn: string; action: string }[]
}

/**
 * Installs a catalogue entry through the REAL install path: catalogue source
 * (git artifact repo at its pinned ref, or the local fixtures) → user token →
 * APISIX gateway → the type's import endpoint. The package content is fetched
 * at install time; nothing installable is shipped with the app.
 */
export async function installEntry(
    _prev: InstallResult | null,
    formData: FormData,
): Promise<InstallResult> {
    const entryId = formData.get('entryId')
    // Data-source choice from the install dialog. Anything unknown (including the
    // dialog-less datastructure form) degrades to 'later' — today's plain install.
    const modeRaw = formData.get('dataSourceMode')
    const dataSourceMode = modeRaw === 'demo' || modeRaw === 'custom' ? modeRaw : 'later'
    const brokerField = formData.get('brokerUrl')
    const customBrokerUrl = typeof brokerField === 'string' ? brokerField.trim() : ''

    let entry: CatalogEntry | undefined
    try {
        entry = typeof entryId === 'string' ? await resolveCatalogEntry(entryId) : undefined
    } catch (error) {
        // A package that cannot be fetched or does not hang together must
        // fail loudly here — never install a half-assembled bundle.
        return {
            status: 'error',
            detail:
                error instanceof BundleError
                    ? `Paket-Quelle nicht verfügbar: ${error.message}`
                    : `Paket-Quelle nicht verfügbar: ${String(error)}`,
            httpStatus: error instanceof BundleError ? error.status : 0,
        }
    }
    if (!entry) {
        return {
            status: 'error',
            detail: `Unbekannter Katalog-Eintrag: ${String(entryId)}`,
            httpStatus: 0,
        }
    }

    if (isDataStructureEntry(entry)) {
        const res = await postImport('/v1/imports/datastructures', {
            name: entry.manifest.displayName,
            description: clampDescription(entry.manifest.description),
            model: entry.artifact,
            modelName: entry.manifest.displayName,
            versionDescription: versionProvenance(
                entry.manifest.displayName,
                entry.manifest.version,
            ),
            // Same catalogue identity the bundle path sends, so this install shows up in the
            // provenance too instead of being invisible under "Installiert".
            catalogEntryId: entry.manifest.id,
            catalogEntryVersion: entry.manifest.version,
        })
        if (res.ok) {
            const body = (await res.response.json()) as { modelUrn?: string }
            revalidatePath('/datastructures')
            revalidatePath('/installed')
            revalidatePath('/instance')
            return { status: 'created', detail: body.modelUrn ?? entry.manifest.id, httpStatus: 201 }
        }
        return res.failure
    }

    // 'custom' applies the user's broker URL to the datasources that declare it
    // as an install parameter — the manifest decides what is instance-local.
    const effectiveEntry: UseCaseEntry =
        dataSourceMode === 'custom' && customBrokerUrl
            ? {
                  ...entry,
                  bundle: {
                      ...entry.bundle,
                      dataSources: applyDeclaredUrlOverride(entry.bundle.dataSources, customBrokerUrl),
                  },
              }
            : entry

    const res = await postImport('/v1/imports/datasets', buildUseCaseBundleBody(effectiveEntry))
    if (res.ok) {
        const body = (await res.response.json()) as DataSetImportSummary
        const structures = (body.dataStructures ?? [])
            .map((s) => `${s.urn} (${s.action})`)
            .join(', ')
        const sources = body.dataSources?.length ?? 0
        const mappings = (body.mappings ?? []).map((m) => `${m.name} (${m.action})`).join(', ')
        const mappingSegment = mappings ? ` · Mappings: ${mappings}` : ''
        // A use-case bundle installs five member kinds; a summary that reports three reads as
        // full success while staying silent about the two that decide whether a release can
        // deploy anything. Both are counted, and an absent kind says so rather than vanishing.
        const sinks = body.dataSinks?.length ?? 0
        const pipelines = body.pipelines?.length ?? 0
        const flowSegment = ` · ${sinks} Senke(n) · ${pipelines} Pipeline(s)`
        // Demo activation happens AFTER the install committed, and its failure is a
        // warning in the summary, never an install failure: the simulator is an
        // add-on, and a dead add-on must not make a use case uninstallable.
        const demoSegment =
            dataSourceMode === 'demo' ? await activateDemoStreams(entry, body.installationId) : ''
        const installation = body.installationId ? ` · Installation ${body.installationId}` : ''
        // The catalogue badge and the provenance list both read from the install
        // record that just came into existence.
        revalidatePath('/use-cases')
        revalidatePath('/installed')
        return {
            status: 'created',
            detail: `Dataset „${body.dataSetName ?? entry.manifest.displayName}" angelegt · Strukturen: ${structures || '—'} · ${sources} Quelle(n)${mappingSegment}${flowSegment}${demoSegment}${installation}`,
            httpStatus: 201,
        }
    }
    return res.failure
}

/**
 * Meta fields of a CORE-IR connector document that never travel inside the
 * wire configuration: identity and self-description belong to the catalogue
 * (and, on the instance side, to the registry's own stamps), not to the
 * connector payload.
 */
const CONNECTOR_META_FIELDS = ['$schema', 'id', 'title', 'description', 'connectionType'] as const

function connectorConfiguration(
    document: Record<string, unknown>,
    alsoStrip: readonly string[] = [],
): Record<string, unknown> {
    const configuration: Record<string, unknown> = { ...document }
    for (const field of [...CONNECTOR_META_FIELDS, ...alsoStrip]) delete configuration[field]
    return configuration
}

// "build" prefix: dodges the react-hooks lint rule that treats any use*
// function as a hook.
function buildUseCaseBundleBody(entry: UseCaseEntry) {
    return {
        name: entry.manifest.displayName,
        description: clampDescription(entry.manifest.description),
        // Bundle identity for the backend's install provenance — recorded
        // verbatim in the installation header, never interpreted.
        catalogEntryId: entry.manifest.id,
        catalogEntryVersion: entry.manifest.version,
        dataStructures: entry.bundle.dataStructures.map((structure) => ({
            name: structure.name,
            description: clampDescription(structure.description),
            model: structure.model,
            // The modeller titles its canvas from this; unset it reads as "Untitled Diagram",
            // which looks like the structure lost its name rather than its layout.
            modelName: structure.name,
            versionDescription: versionProvenance(
                entry.manifest.displayName,
                entry.manifest.version,
            ),
        })),
        // Sources and sinks are authored as CORE-IR connector documents; the
        // wire API predates that form and wants name/type/configuration with
        // no adoptable identity. This mapping is the whole seam — when the
        // platform grows an identity-keeping door for connector shells, only
        // this function changes, not the catalogue.
        dataSources: entry.bundle.dataSources.map((source) => ({
            name: source.document.title,
            description: clampDescription(source.document.description),
            // The source contract wants the structure reference OUTSIDE the
            // configuration ('mqtt' → 'MQTT', 'sql' → 'SQL')…
            dataStructureUrn: source.document.element,
            connectorType: String(source.document.connectionType ?? '').toUpperCase(),
            configuration: connectorConfiguration(source.document, ['element']),
        })),
        mappings: entry.bundle.mappings.map((mapping) => ({
            name: mapping.name,
            description: clampDescription(mapping.description),
            mappingUrn: mapping.mappingUrn,
            document: mapping.document,
        })),
        dataSinks: entry.bundle.dataSinks.map((sink) => ({
            name: sink.document.title,
            dataSinkType: String(sink.document.connectionType ?? '').toUpperCase(),
            // …while the sink contract keeps `element` (and tableName) INSIDE it.
            configuration: connectorConfiguration(sink.document),
        })),
        pipelines: entry.bundle.pipelines.map((pipeline) => ({
            name: pipeline.name,
            description: clampDescription(pipeline.description),
            model: pipeline.model,
        })),
    }
}

/**
 * Registers one simulator publisher per bundled stream (stage B). Every
 * outcome — good or bad — comes back as a summary segment: a demo activation
 * that fails must say so in the install feedback, and one that silently
 * skipped streams would be finding-3 all over again.
 */
async function activateDemoStreams(
    entry: UseCaseEntry,
    installationId: string | undefined,
): Promise<string> {
    if (!isSimulatorConfigured()) {
        return ' · Demo-Daten NICHT aktiviert: SIMULATOR_API_URL ist nicht konfiguriert'
    }
    if (!installationId) {
        return ' · Demo-Daten NICHT aktiviert: Antwort trägt keine Installations-ID'
    }
    try {
        // SIMULATOR_BROKER_URL overrides the package's broker for the simulator
        // only — needed when the simulator runs outside the docker network and
        // the container-name URL does not resolve for it.
        const planned = planSimulations(entry, installationId, process.env.SIMULATOR_BROKER_URL)
        if (planned.length === 0) {
            return ' · Demo-Daten: Paket bündelt keine Szenarien'
        }
        // Same core as the installed page's reactivation button: per-stream
        // failure collection, so a partial activation names its gap instead of
        // hiding the successes behind the first error.
        const outcome = await registerPlanned(planned, installationId, registerSimulation)
        if (outcome.failed.length === 0) {
            return ` · Demo-Daten: ${outcome.registered.length} Stream(s) aktiv`
        }
        const failures = outcome.failed
            .map(({ streamName, detail }) => `${streamName} (${detail})`)
            .join(', ')
        return ` · Demo-Daten: ${outcome.registered.length} Stream(s) aktiv, fehlgeschlagen: ${failures}`
    } catch (error) {
        return ` · Demo-Daten NICHT aktiviert: ${error instanceof Error ? error.message : String(error)}`
    }
}

/**
 * Sweeps the simulator for this installation's publishers by id prefix. Runs
 * only after the uninstall committed — the reverse order could strand a live
 * installation without its demo data when the uninstall is then refused.
 */
async function removeDemoStreams(installationId: string): Promise<string> {
    if (!isSimulatorConfigured()) return ''
    try {
        const prefix = simulationIdPrefix(installationId)
        const ids = (await listSimulationIds()).filter((id) => id.startsWith(prefix))
        for (const id of ids) {
            await deleteSimulation(id)
        }
        return ids.length > 0 ? ` · ${ids.length} Demo-Stream(s) entfernt` : ''
    } catch (error) {
        return ` · Demo-Stream-Aufräumen fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`
    }
}

type PostResult = { ok: true; response: Response } | { ok: false; failure: InstallResult }

async function postImport(path: string, body: unknown): Promise<PostResult> {
    const accessToken = await getAccessToken()

    const response = await fetch(`${process.env.API_BASE_URL}:${process.env.API_PORT}${path}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
    })

    if (response.status === 201) return { ok: true, response }

    // Backend errors arrive as RFC-9457 ProblemDetail: `detail` carries the
    // actionable message our own guards wrote (400 guards, 409 turnstile).
    const problem = (await response.json().catch(() => null)) as { detail?: string } | null
    const detail = problem?.detail ?? `${response.status} ${response.statusText}`
    const status =
        response.status === 409 ? 'conflict' : response.status === 400 ? 'invalid' : 'error'
    return { ok: false, failure: { status, detail, httpStatus: response.status } }
}

export interface UninstallResult {
    status: 'uninstalled' | 'conflict' | 'invalid' | 'error'
    detail: string
    httpStatus: number
}

/**
 * Uninstalls a structure-only installation through the platform's provenance
 * API. The record survives as history (uninstalledAt set); the structure —
 * shell, version and registry model — is deleted by the backend, so the
 * catalogue badge frees up and the entry becomes installable again.
 */
export async function uninstallInstallation(
    _prev: UninstallResult | null,
    formData: FormData,
): Promise<UninstallResult> {
    const installationId = formData.get('installationId')
    if (typeof installationId !== 'string' || installationId.length === 0) {
        return { status: 'error', detail: 'installationId fehlt', httpStatus: 0 }
    }

    const accessToken = await getAccessToken()
    const response = await fetch(
        `${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/installations/${installationId}`,
        {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: 'no-store',
        },
    )

    if (response.status === 204) {
        const cleanup = await removeDemoStreams(installationId)
        revalidatePath('/installed')
        revalidatePath('/datastructures')
        revalidatePath('/use-cases')
        revalidatePath('/instance')
        return { status: 'uninstalled', detail: `Deinstalliert${cleanup}`, httpStatus: 204 }
    }

    const problem = (await response.json().catch(() => null)) as { detail?: string } | null
    const detail = problem?.detail ?? `${response.status} ${response.statusText}`
    const status =
        response.status === 409 ? 'conflict' : response.status === 400 ? 'invalid' : 'error'
    return { status, detail, httpStatus: response.status }
}
