'use server'

import { revalidatePath } from 'next/cache'

import { BundleError } from '@/lib/catalog/bundle'
import { resolveCatalogEntry } from '@/lib/catalog/source'
import { isDataStructureEntry, type CatalogEntry, type UseCaseEntry } from '@/lib/catalog/types'
import {
    InstallPayloadError,
    applyDeclaredDsnOverride,
    applyDeclaredUrlOverride,
    buildInstallationRequest,
    describeInstallFailure,
    describeUninstallFailure,
    resolveBrokerOverride,
    resolveDsnOverride,
    summarizeInstallation,
    type InstallationReceipt,
    type InstallationRequest,
} from '@/lib/install-payload'
import { getAccessToken, requireSession } from '@/lib/session'
import {
    deleteSimulation,
    isSimulatorConfigured,
    listSimulationIds,
    registerSimulation,
} from '@/lib/simulator/client'
import { planSimulations, registerPlanned, simulationIdPrefix } from '@/lib/simulator/registration'
import { isSupersetConfigured, importDashboard } from '@/lib/superset/client'
import { createZip } from '@/lib/superset/zip'
import { stringify as stringifyYaml } from 'yaml'

export interface InstallResult {
    status: 'created' | 'conflict' | 'invalid' | 'error'
    /** Human-readable summary (created) or backend message (ProblemDetail.detail). */
    detail: string
    httpStatus: number
}

type DataSourceMode = 'demo' | 'custom' | 'later'

/**
 * Installs a catalogue entry through the REAL install path: catalogue source
 * (git artifact repo at its pinned ref, or the local fixtures) → user token →
 * APISIX gateway → `POST /v1/installations`. The package content is fetched
 * at install time; nothing installable is shipped with the app.
 *
 * One request installs the whole package or nothing: the platform creates
 * every member in a single transaction and answers with the installation and
 * one line per artifact it made.
 */
export async function installEntry(
    _prev: InstallResult | null,
    formData: FormData,
): Promise<InstallResult> {
    // A server action answers a plain POST, whatever the page around the form checked.
    await requireSession()

    const entryId = formData.get('entryId')
    // Data-source choice from the install dialog. Anything unknown (including the
    // dialog-less datastructure form) degrades to 'later' — today's plain install.
    const modeRaw = formData.get('dataSourceMode')
    const dataSourceMode: DataSourceMode =
        modeRaw === 'demo' || modeRaw === 'custom' ? modeRaw : 'later'
    const brokerField = formData.get('brokerUrl')
    const customBrokerUrl = typeof brokerField === 'string' ? brokerField.trim() : ''
    const poolField = formData.get('datapoolId')
    const datapoolId = typeof poolField === 'string' ? poolField.trim() : ''

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

    let effectiveEntry: CatalogEntry = entry
    if (!isDataStructureEntry(entry)) {
        // The dialog does not let the user get this far without a datapool; this is for the
        // request that never went through the dialog.
        if (!datapoolId) {
            return {
                status: 'error',
                detail: 'Kein Datenpool gewählt. Datenquellen und Datensatz eines Anwendungsfalls werden in einem Datenpool angelegt.',
                httpStatus: 0,
            }
        }
        effectiveEntry = withInstanceAddresses(entry, dataSourceMode, customBrokerUrl)
    }

    let request: InstallationRequest
    try {
        request = buildInstallationRequest(effectiveEntry, datapoolId || undefined)
    } catch (error) {
        if (!(error instanceof InstallPayloadError)) throw error
        return {
            status: 'error',
            detail: `Paket nicht installierbar: ${error.message}`,
            httpStatus: 0,
        }
    }

    const res = await postInstallation(request)
    if (!res.ok) return res.failure

    const receipt = (await res.response.json()) as InstallationReceipt
    const summary = summarizeInstallation(receipt, entry.manifest.displayName)
    // Demo activation happens AFTER the install committed, and its failure is a
    // warning in the summary, never an install failure: the simulator is an
    // add-on, and a dead add-on must not make a use case uninstallable.
    // effectiveEntry, not entry: the planner reads the datasource document
    // to learn where the platform listens and reads, so it has to see the
    // same overrides the platform just got. On the MQTT side the raw entry
    // survived only because SIMULATOR_BROKER_URL patches the generator's
    // view separately; SQL has no such second setting.
    const demoSegment =
        dataSourceMode === 'demo' && !isDataStructureEntry(effectiveEntry)
            ? await activateDemoStreams(effectiveEntry, receipt.id)
            : ''
    // Same rule as the demo data: the install has committed, so a dashboard
    // that fails to import is a remark in the summary, never an install failure.
    const dashboardSegment = isDataStructureEntry(effectiveEntry)
        ? ''
        : await activateDashboards(effectiveEntry, receipt.dataSetId)
    const installation = receipt.id ? ` · Installation ${receipt.id}` : ''

    // The catalogue badges and the provenance list all read from the install
    // record that just came into existence.
    revalidatePath('/use-cases')
    revalidatePath('/(authenticated)/use-cases/[publisher]/[slug]', 'page')
    revalidatePath('/datastructures')
    revalidatePath('/installed')
    revalidatePath('/instance')
    return {
        status: 'created',
        detail: `${summary}${demoSegment}${dashboardSegment}${installation}`,
        httpStatus: 201,
    }
}

/**
 * The entry with the addresses of THIS instance written into the datasources
 * that declare them as install parameters, and only into those.
 *
 * 'custom' applies the user's broker URL, 'demo' applies
 * DEMO_DATASOURCE_BROKER_URL: the demo broker as the PLATFORM reaches it, so
 * the NiFi subscription and the simulator's stream registrations meet at one
 * broker on deployments where both run in the same network (the cluster).
 * NOT SIMULATOR_BROKER_URL: locally that is the HOST's view of the broker,
 * which NiFi inside the compose network cannot reach. There the variable
 * stays unset and the package default stands.
 *
 * The same idea for the SQL half: 'demo' points the platform at the database
 * the generator writes to. Without it the platform kept the package's
 * placeholder address while the generator wrote to its own database, and the
 * generator's name check refused the registration. Correctly so, since the
 * rows would never have been read.
 */
function withInstanceAddresses(
    entry: UseCaseEntry,
    dataSourceMode: DataSourceMode,
    customBrokerUrl: string,
): UseCaseEntry {
    const overrideBrokerUrl = resolveBrokerOverride(
        dataSourceMode,
        customBrokerUrl,
        process.env.DEMO_DATASOURCE_BROKER_URL,
    )
    const overrideDsn = resolveDsnOverride(dataSourceMode, process.env.DEMO_DATASOURCE_DB_DSN)

    let dataSources = entry.bundle.dataSources
    if (overrideBrokerUrl) dataSources = applyDeclaredUrlOverride(dataSources, overrideBrokerUrl)
    if (overrideDsn) dataSources = applyDeclaredDsnOverride(dataSources, overrideDsn)
    return dataSources === entry.bundle.dataSources
        ? entry
        : { ...entry, bundle: { ...entry.bundle, dataSources } }
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
 * Imports bundled dashboards into Superset if configured. Runs after the dataset
 * import succeeded, binding the dashboard's schema references dynamically to the
 * newly minted dataset UUID (`ds_<datasetId>`).
 */
async function activateDashboards(entry: UseCaseEntry, dataSetId: string | undefined): Promise<string> {
    const dashboards = entry.bundle.dashboards ?? []
    if (dashboards.length === 0 || !isSupersetConfigured()) return ''

    const results: string[] = []
    for (const dashboard of dashboards) {
        if (dashboard.tool === 'superset') {
            try {
                let zipBuf: Buffer | undefined
                if (typeof dashboard.content.zipBase64 === 'string') {
                    zipBuf = Buffer.from(dashboard.content.zipBase64, 'base64')
                } else if (typeof dashboard.content.assets === 'object' && dashboard.content.assets !== null) {
                    const files: Record<string, string> = {
                        'metadata.yaml': stringifyYaml({
                            version: '1.0.0',
                            type: 'Dashboard',
                            timestamp: new Date().toISOString(),
                        }),
                    }
                    const assets = dashboard.content.assets as Record<string, unknown[]>
                    if (Array.isArray(assets.dashboards)) {
                        for (const d of assets.dashboards) {
                            if (typeof d === 'object' && d !== null && typeof (d as { slug?: string }).slug === 'string') {
                                files[`dashboards/${(d as { slug: string }).slug}.yaml`] = stringifyYaml(d)
                            }
                        }
                    }
                    if (Array.isArray(assets.charts)) {
                        for (const [idx, c] of assets.charts.entries()) {
                            if (typeof c === 'object' && c !== null) {
                                const sliceName = (c as { slice_name?: string }).slice_name
                                const slug = typeof sliceName === 'string'
                                    ? sliceName.toLowerCase().replace(/[^a-z0-9]+/g, '_')
                                    : `chart_${idx}`
                                files[`charts/${slug}.yaml`] = stringifyYaml(c)
                            }
                        }
                    }
                    if (Array.isArray(assets.datasets)) {
                        for (const ds of assets.datasets) {
                            if (typeof ds === 'object' && ds !== null && typeof (ds as { table_name?: string }).table_name === 'string') {
                                files[`datasets/payload_data/${(ds as { table_name: string }).table_name}.yaml`] = stringifyYaml(ds)
                            }
                        }
                    }
                    zipBuf = createZip(files)
                }

                if (zipBuf) {
                    const res = await importDashboard(zipBuf, {
                        datasetId: dataSetId,
                        schema: dashboard.bindings?.schema,
                        table: dashboard.bindings?.table,
                        database: dashboard.bindings?.database,
                    })
                    if (res.ok) {
                        results.push(res.dashboardTitle ?? dashboard.file)
                    }
                }
            } catch (err) {
                console.error('Failed to import dashboard into Superset:', err)
            }
        }
    }
    return results.length ? ` · Dashboard in Superset: ${results.join(', ')}` : ''
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

async function postInstallation(body: InstallationRequest): Promise<PostResult> {
    const accessToken = await getAccessToken()

    const response = await fetch(
        `${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/installations`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            cache: 'no-store',
        },
    )

    if (response.status === 201) return { ok: true, response }

    const failure = describeInstallFailure(
        response.status,
        response.statusText,
        await response.text().catch(() => ''),
    )
    return { ok: false, failure: { ...failure, httpStatus: response.status } }
}

export interface UninstallResult {
    status: 'uninstalled' | 'conflict' | 'invalid' | 'error'
    detail: string
    httpStatus: number
}

/**
 * Uninstalls an installation through the platform's installation resource.
 * A platform that does not offer this yet says so in one sentence instead of
 * a bare status code; the artifacts can then be removed one by one in the
 * portal.
 */
export async function uninstallInstallation(
    _prev: UninstallResult | null,
    formData: FormData,
): Promise<UninstallResult> {
    await requireSession()

    const installationId = formData.get('installationId')
    if (typeof installationId !== 'string' || installationId.length === 0) {
        return { status: 'error', detail: 'installationId fehlt', httpStatus: 0 }
    }

    const accessToken = await getAccessToken()
    const response = await fetch(
        `${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/installations/${encodeURIComponent(installationId)}`,
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
        revalidatePath('/(authenticated)/use-cases/[publisher]/[slug]', 'page')
        revalidatePath('/instance')
        return { status: 'uninstalled', detail: `Deinstalliert${cleanup}`, httpStatus: 204 }
    }

    const failure = describeUninstallFailure(
        response.status,
        response.statusText,
        await response.text().catch(() => ''),
    )
    return { ...failure, httpStatus: response.status }
}
