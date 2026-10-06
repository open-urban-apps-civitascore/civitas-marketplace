'use server'

import { revalidatePath } from 'next/cache'

import { BundleError } from '@/lib/catalog/bundle'
import { resolveCatalogEntry } from '@/lib/catalog/source'
import { isDataStructureEntry, type CatalogEntry, type UseCaseEntry } from '@/lib/catalog/types'
import { DATAPOOL_NAME_MIN } from '@/lib/datapool-name'
import { createDatapool, deleteDatapool, type DatapoolOption } from '@/lib/datapools'
import {
    InstallPayloadError,
    applyDeclaredDsnOverride,
    applyDeclaredUrlOverride,
    buildInstallationRequest,
    clampDescription,
    describeInstallFailure,
    describeReleaseFailure,
    describeUninstallFailure,
    resolveBrokerOverride,
    resolveDsnOverride,
    summarizeInstallation,
    type InstallationReceipt,
    type InstallationRequest,
} from '@/lib/install-payload'
import { fetchInstalledDashboards } from '@/lib/installed-dashboards'
import { fetchInstallationFacts, type InstallationFacts } from '@/lib/installations'
import { datasetHref } from '@/lib/portal-links'
import { getAccessToken, requireSession } from '@/lib/session'
import {
    deleteSimulation,
    isSimulatorConfigured,
    listSimulationIds,
    registerSimulation,
} from '@/lib/simulator/client'
import { planSimulations, registerPlanned, simulationIdPrefix } from '@/lib/simulator/registration'
import {
    installDashboard,
    missingSupersetSettings,
    removeInstallationDashboards,
    supersetConfig,
    type SupersetConfig,
} from '@/lib/superset/client'

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
    // The dialog sends either a pool to install into or the name of one to
    // create; its mode decides which of the two fields counts.
    const newPoolRequested = formData.get('datapoolMode') === 'new'
    const poolField = formData.get('datapoolId')
    const datapoolId = !newPoolRequested && typeof poolField === 'string' ? poolField.trim() : ''
    const newPoolField = formData.get('newDatapoolName')
    const newDatapoolName =
        newPoolRequested && typeof newPoolField === 'string' ? newPoolField.trim() : ''
    // The dialog's release choice. Anything else, the dialog-less structure
    // form included, installs a draft: a release publishes data, so it is
    // never the default.
    const releaseRequested = formData.get('releaseMode') === 'release'

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
        if (!datapoolId && !newDatapoolName) {
            return {
                status: 'error',
                detail: 'Kein Datenpool gewählt. Datenquellen und Datensatz eines Anwendungsfalls werden in einem Datenpool angelegt.',
                httpStatus: 0,
            }
        }
        if (newDatapoolName && newDatapoolName.length < DATAPOOL_NAME_MIN) {
            return {
                status: 'invalid',
                detail: `Der Name des neuen Datenpools braucht mindestens ${DATAPOOL_NAME_MIN} Zeichen.`,
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

    // The new pool comes only now, once the package has become a valid request:
    // a package that cannot be installed must not leave an empty pool behind.
    let createdPool: DatapoolOption | undefined
    if (newDatapoolName && !isDataStructureEntry(effectiveEntry)) {
        const creation = await createDatapool(
            newDatapoolName,
            clampDescription(
                `Angelegt bei der Installation von „${entry.manifest.displayName}“ v${entry.manifest.version} aus dem Marketplace.`,
            ) ?? newDatapoolName,
        )
        if (!creation.ok) return creation.failure
        createdPool = creation.pool
        request = { ...request, datapoolId: creation.pool.id }
    }

    const res = await postInstallation(request)
    if (!res.ok) {
        // Nothing went into the new pool, so it goes again rather than linger empty.
        if (!createdPool) return res.failure
        return { ...res.failure, detail: `${res.failure.detail}${await discardCreatedPool(createdPool)}` }
    }

    const receipt = (await res.response.json()) as InstallationReceipt
    const summary = summarizeInstallation(receipt, entry.manifest.displayName)
    const poolSegment = createdPool ? ` · Datenpool „${createdPool.name}“ neu angelegt` : ''
    // The first follow-up, so the platform provisions while the demo data and
    // the dashboards are still being set up. Like them, a refusal is a remark
    // in the summary, never an install failure.
    const release =
        releaseRequested && !isDataStructureEntry(effectiveEntry)
            ? await releaseInstalledDataset(receipt.dataSetId)
            : { started: false, segment: '' }
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
        : await activateDashboards(effectiveEntry, receipt, release.started)
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
        detail: `${summary}${poolSegment}${release.segment}${demoSegment}${dashboardSegment}${installation}`,
        httpStatus: 201,
    }
}

/** Removes a pool this install created and could not fill, and says how that went. */
async function discardCreatedPool(pool: DatapoolOption): Promise<string> {
    return (await deleteDatapool(pool.id))
        ? ` · Der dafür angelegte Datenpool „${pool.name}“ wurde wieder entfernt`
        : ` · Der dafür angelegte Datenpool „${pool.name}“ ist leer stehen geblieben und lässt sich im Portal löschen`
}

/**
 * Releases the dataset an install just created, in the two steps the portal
 * takes as well: stage (DRAFT to READY, checked at once), then release (READY
 * to AVAILABLE). The platform then provisions sinks, routes and the pipeline
 * in a saga, and the data flows once that is done.
 *
 * A refused step ends here and says which one it was: a refused stage leaves
 * the draft, a refused release a staged dataset, and the portal can release
 * either. Nothing is rolled back, because nothing is wrong with the install.
 */
async function releaseInstalledDataset(
    dataSetId: string | undefined,
): Promise<{ started: boolean; segment: string }> {
    if (!dataSetId) {
        return { started: false, segment: ' · Freigabe NICHT gestartet: Antwort trägt keine Datensatz-ID' }
    }
    // Outside the try block: a missing session ends in a redirect, which
    // travels as an exception and must not read as an unreachable backend.
    const accessToken = await getAccessToken()

    for (const step of ['stage', 'release'] as const) {
        let response: Response
        try {
            response = await fetch(
                `${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/datasets/${encodeURIComponent(dataSetId)}/${step}`,
                {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${accessToken}` },
                    cache: 'no-store',
                },
            )
        } catch (error) {
            return {
                started: false,
                segment: ` · Freigabe NICHT gestartet: Portal-Backend nicht erreichbar (${error instanceof Error ? error.message : String(error)})`,
            }
        }
        if (!response.ok) {
            return {
                started: false,
                segment: describeReleaseFailure(
                    step,
                    response.status,
                    response.statusText,
                    await response.text().catch(() => ''),
                ),
            }
        }
    }
    return {
        started: true,
        segment: ' · Freigabe gestartet: Die Plattform richtet Speicher und Pipeline ein, danach fließen die Daten',
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
 * Imports the use case's dashboards into Superset, bound to this installation
 * (see lib/superset/rebind). Like the demo activation, every outcome comes
 * back as a summary segment: a dashboard that is missing must say why, and
 * one that arrived must say where.
 */
async function activateDashboards(
    entry: UseCaseEntry,
    receipt: InstallationReceipt,
    releaseStarted: boolean,
): Promise<string> {
    if ((entry.bundle.dashboards ?? []).length === 0) return ''
    const config = supersetConfig()
    if (!config) {
        return ` · Dashboard NICHT eingespielt: ${missingSupersetSettings().join(', ')} nicht konfiguriert`
    }
    const { id: installationId, dataSetId } = receipt
    if (!installationId || !dataSetId) {
        return ' · Dashboard NICHT eingespielt: Antwort trägt keine Installations- oder Datensatz-ID'
    }
    const outcomes = await importDashboards(
        entry,
        { installationId, dataSetId, dataSetName: receipt.dataSetName ?? entry.manifest.displayName },
        config,
    )
    // Until its dataset is released, a dashboard's table does not exist. After a
    // release started here it appears once the platform has provisioned it.
    const hint = releaseStarted
        ? ' (zeigt Daten, sobald die Freigabe abgeschlossen ist)'
        : ' (zeigt Daten nach der Freigabe im Portal)'
    return outcomes.map(({ ok, text }) => ` · ${text}${ok ? hint : ''}`).join('')
}

interface DashboardTarget {
    installationId: string
    dataSetId: string
    dataSetName: string
}

/** Imports every dashboard of the entry for one installation: one outcome line each. */
async function importDashboards(
    entry: UseCaseEntry,
    target: DashboardTarget,
    config: SupersetConfig,
): Promise<{ ok: boolean; text: string }[]> {
    const notice = releaseNotice(target.dataSetName, target.dataSetId)
    const outcomes: { ok: boolean; text: string }[] = []
    for (const dashboard of entry.bundle.dashboards ?? []) {
        try {
            const installed = await installDashboard(
                dashboard.content,
                { installationId: target.installationId, datasetId: target.dataSetId, notice },
                config,
            )
            outcomes.push({ ok: true, text: `Dashboard „${installed.title ?? dashboard.file}“: ${installed.url}` })
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            outcomes.push({ ok: false, text: `Dashboard ${dashboard.file} NICHT eingespielt: ${reason}` })
        }
    }
    return outcomes
}

export interface ReimportResult {
    status: 'imported' | 'error'
    detail: string
}

/**
 * Imports the dashboards of an existing installation again: after an import
 * that failed at install time, for an installation older than the Superset
 * configuration, or after a dashboard was deleted in Superset. The
 * installation and its release stay untouched. The import binds to the same
 * derived UUIDs and slug, so it creates the dashboard the page links to, or
 * replaces it with the package's version.
 */
export async function reimportDashboards(
    _prev: ReimportResult | null,
    formData: FormData,
): Promise<ReimportResult> {
    await requireSession()

    const installationId = formData.get('installationId')
    if (typeof installationId !== 'string' || installationId.length === 0) {
        return { status: 'error', detail: 'installationId fehlt' }
    }
    // Package and dataset come from the platform's record, read with the
    // user's token, never from the form.
    const installation = await fetchInstallationFacts(installationId, await getAccessToken())
    if (!installation?.active || !installation.packageId || !installation.dataSetId) {
        return { status: 'error', detail: 'Keine aktive Installation mit Datensatz gefunden.' }
    }
    const config = supersetConfig()
    if (!config) {
        return { status: 'error', detail: `${missingSupersetSettings().join(', ')} nicht konfiguriert` }
    }

    let entry: CatalogEntry | undefined
    try {
        entry = await resolveCatalogEntry(installation.packageId)
    } catch (error) {
        return {
            status: 'error',
            detail: `Paket-Quelle nicht verfügbar: ${error instanceof Error ? error.message : String(error)}`,
        }
    }
    if (!entry || isDataStructureEntry(entry) || (entry.bundle.dashboards ?? []).length === 0) {
        return { status: 'error', detail: 'Das Paket bringt kein Dashboard mit.' }
    }

    const outcomes = await importDashboards(
        entry,
        {
            installationId,
            dataSetId: installation.dataSetId,
            dataSetName: installation.dataSetName ?? entry.manifest.displayName,
        },
        config,
    )
    return {
        status: outcomes.every(({ ok }) => ok) ? 'imported' : 'error',
        detail: outcomes.map(({ text }) => text).join(' · '),
    }
}

/**
 * The text tile the import puts on top of every dashboard of the use case.
 * Until the dataset is released its table does not exist, and Superset only
 * says that a relation is missing; the tile says what to do instead. It stays
 * after the release, so it is written to be true in both states.
 */
function releaseNotice(dataSetName: string, dataSetId: string): string {
    return [
        '**Keine Daten zu sehen?**',
        `Dieses Dashboard zeigt den Datensatz „${dataSetName}“. Daten erscheinen, sobald er im Portal freigegeben ist und seine Pipeline geliefert hat.`,
        `[Datensatz im Portal öffnen](${datasetHref(dataSetId)})`,
    ].join('\n\n')
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

/**
 * Removes what the installation brought into Superset: dashboards, charts and
 * datasets. Runs after the uninstall committed, like the demo-stream sweep,
 * and reports instead of failing: the platform side is gone either way.
 */
async function removeSupersetObjects(installationId: string, installation: InstallationFacts | null): Promise<string> {
    const config = supersetConfig()
    if (!config || !installation?.dataSetId) return ''
    try {
        const slugs = installation.packageId
            ? (await fetchInstalledDashboards(installation.packageId, installationId)).map(({ slug }) => slug)
            : []
        const removed = await removeInstallationDashboards(config, { dataSetId: installation.dataSetId, slugs })
        if (removed.dashboards + removed.charts + removed.datasets === 0) return ''
        return ` · Superset: ${removed.dashboards} Dashboard(s), ${removed.charts} Chart(s), ${removed.datasets} Dataset(s) entfernt`
    } catch (error) {
        return ` · Superset-Aufräumen fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`
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
    // Read before the DELETE: the Superset cleanup needs the package (for the
    // dashboard slug) and the dataset (for the schema).
    const installation = await fetchInstallationFacts(installationId, accessToken)
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
        const supersetCleanup = await removeSupersetObjects(installationId, installation)
        revalidatePath('/installed')
        revalidatePath('/datastructures')
        revalidatePath('/use-cases')
        revalidatePath('/(authenticated)/use-cases/[publisher]/[slug]', 'page')
        revalidatePath('/instance')
        return { status: 'uninstalled', detail: `Deinstalliert${cleanup}${supersetCleanup}`, httpStatus: 204 }
    }

    const failure = describeUninstallFailure(
        response.status,
        response.statusText,
        await response.text().catch(() => ''),
    )
    return { ...failure, httpStatus: response.status }
}
