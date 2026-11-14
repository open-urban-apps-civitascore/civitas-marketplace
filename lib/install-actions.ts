'use server'

import { revalidatePath } from 'next/cache'

import { BundleError } from '@/lib/catalog/bundle'
import { resolveCatalogEntry } from '@/lib/catalog/source'
import { isDataStructureEntry, type CatalogEntry, type UseCaseEntry } from '@/lib/catalog/types'
import { DATAPOOL_NAME_MIN } from '@/lib/datapool-name'
import { createDatapool, deleteDatapool, type DatapoolOption } from '@/lib/datapools'
import { installedDataSets } from '@/lib/installation-dataset'
import {
    awaitRelease,
    releaseUseCase,
    type PlatformAnswer,
    type PlatformApi,
    type ReleaseCounts,
    type SagaOutcome,
    type WaitOptions,
} from '@/lib/release-chain'
import {
    InstallPayloadError,
    applyDeclaredDsnOverride,
    applyDeclaredUrlOverride,
    artifactCounts,
    buildInstallationRequest,
    clampDescription,
    dataSetIdentity,
    describeInstallFailure,
    describeReleaseFailure,
    describeUninstallFailure,
    installSteps,
    readFailure,
    resolveBrokerOverride,
    resolveDsnOverride,
    summarizeInstallation,
    type ArtifactCount,
    type InstallationReceipt,
    type InstallationRequest,
    type InstallStep,
} from '@/lib/install-payload'
import {
    dashboardCreation,
    fetchInstalledDashboards,
    type DashboardCreation,
    type InstalledDashboardLink,
} from '@/lib/installed-dashboards'
import { getAccessToken, requireSession } from '@/lib/session'
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
    /** The platform's id for the new installation, on success. */
    installationId?: string
    /** The same success as data, for a view that lists it instead of one line of text. */
    outcome?: InstallOutcome
}

export interface InstallOutcome {
    title: string
    version: string
    counts: ArtifactCount[]
    steps: InstallStep[]
}

type DataSourceMode = 'demo' | 'custom' | 'later'

/**
 * Installs a catalogue entry through the REAL install path: catalogue source
 * (git artifact repo at its pinned ref, or the local fixtures) → user token →
 * APISIX gateway → `POST /v1/use-cases`. The package content is fetched
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
        entry = typeof entryId === 'string' ? await resolveCatalogEntry(entryId, { retryFailed: true }) : undefined
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
    // The datasets are lines of the journal, not fields of the answer (installedDataSets).
    const dataSets = installedDataSets(receipt.artifacts)
    // A dashboard goes to the dataset it names: the line whose origin is that dataset's identity.
    const dataSetIdOf = (key: string): string | undefined =>
        isDataStructureEntry(effectiveEntry)
            ? undefined
            : receipt.artifacts?.find(
                  (line) => line.artifactType === 'DATA_SET' && line.origin === dataSetIdentity(effectiveEntry, key),
              )?.shellId
    const title = dataSets.length === 1 ? (dataSets[0].name ?? entry.manifest.displayName) : entry.manifest.displayName
    const summary = summarizeInstallation(receipt, entry.manifest.displayName)
    const poolSegment = createdPool ? ` · Datenpool „${createdPool.name}“ neu angelegt` : ''
    // Before the release: the platform reads a dataset's dashboards when its
    // saga starts, and for a dataset in draft that is the release saga. A
    // dashboard is published as its dataset is: a ticked release publishes
    // both (decision 2026-11-09). A refused dashboard is a remark in the
    // summary, never an install failure.
    const dashboardRefusals = isDataStructureEntry(effectiveEntry)
        ? ''
        : await registerDashboards(effectiveEntry, dataSetIdOf, releaseRequested)
    // Then the release of each dataset, so the platform provisions while the demo data are
    // still being set up. Like them, a refusal is a remark in the summary.
    const releases =
        releaseRequested && !isDataStructureEntry(effectiveEntry)
            ? await startReleases(receipt, dataSets.map((dataSet) => dataSet.id))
            : []
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
            ? await activateDemoStreams(effectiveEntry, receipt)
            : ''
    // Last: the end of each saga, once the rest is set up.
    const released: { completed: boolean; segment: string }[] = []
    for (const run of releases) released.push(await finishRelease(run))
    const releaseSegment = released.map((run) => run.segment).join('')
    const releaseCompleted = released.length > 0 && released.every((run) => run.completed)
    // After the saga, because only then does the platform know where Superset
    // put each dashboard.
    const dashboardSegment =
        isDataStructureEntry(effectiveEntry) || (effectiveEntry.bundle.dashboards ?? []).length === 0
            ? ''
            : `${dashboardRefusals}${await reportDashboards(
                  [...new Set(effectiveEntry.bundle.dashboards?.map((dashboard) => dataSetIdOf(dashboard.dataSet)))],
                  releaseCompleted,
              )}`
    const installation = receipt.id ? ` · Installation ${receipt.id}` : ''

    // The catalogue badges and the provenance list all read from the install
    // record that just came into existence.
    revalidatePath('/use-cases')
    revalidatePath('/(authenticated)/use-cases/[publisher]/[slug]', 'page')
    revalidatePath('/datastructures')
    revalidatePath('/installed')
    return {
        status: 'created',
        detail: `${summary}${poolSegment}${releaseSegment}${demoSegment}${dashboardSegment}${installation}`,
        httpStatus: 201,
        installationId: receipt.id,
        outcome: {
            title,
            version: entry.manifest.version,
            counts: artifactCounts(receipt),
            steps: [
                ...installSteps(poolSegment, true),
                // The release step says NICHT where it did not go through, like the others.
                ...installSteps(releaseSegment),
                ...installSteps(demoSegment),
                ...installSteps(dashboardSegment),
            ],
        },
    }
}

/** Removes a pool this install created and could not fill, and says how that went. */
async function discardCreatedPool(pool: DatapoolOption): Promise<string> {
    return (await deleteDatapool(pool.id))
        ? ` · Der dafür angelegte Datenpool „${pool.name}“ wurde wieder entfernt`
        : ` · Der dafür angelegte Datenpool „${pool.name}“ ist leer stehen geblieben und lässt sich im Portal löschen`
}

/** The platform's API with the user's token, for the release chain. */
function platformApi(accessToken: string): PlatformApi {
    const call = async (method: 'GET' | 'POST', path: string): Promise<PlatformAnswer> => {
        const response = await fetch(`${process.env.API_BASE_URL}:${process.env.API_PORT}${path}`, {
            method,
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: 'no-store',
        })
        return { status: response.status, statusText: response.statusText, text: await response.text().catch(() => '') }
    }
    return { get: (path) => call('GET', path), post: (path) => call('POST', path) }
}

/**
 * How long the install waits for the platform to provision a released dataset. Locally a first
 * release after a stack start takes longest (FROST builds its database layer on the first request).
 */
const RELEASE_WAIT: WaitOptions = {
    timeoutMs: 120_000,
    intervalMs: 2_000,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

type ReleaseRun =
    | { started: true; dataSetId: string; released: ReleaseCounts }
    | { started: false; segment: string }

/**
 * Releases what the install made, as the platform demands it (lib/release-chain.ts): each
 * structure version, each structure, each source, then stage and release of the dataset. That
 * starts the saga; finishRelease waits for its end.
 *
 * A refused step ends here and says which one it was. Nothing is rolled back, because nothing is
 * wrong with the install, and the portal can go on from there.
 */
async function startReleases(receipt: InstallationReceipt, dataSetIds: (string | undefined)[]): Promise<ReleaseRun[]> {
    if (dataSetIds.length === 0) return [await startRelease(receipt, undefined, true)]
    const runs: ReleaseRun[] = []
    // The structure versions and sources serve every dataset, so the first release takes them.
    for (const [index, dataSetId] of dataSetIds.entries()) {
        runs.push(await startRelease(receipt, dataSetId, index === 0))
    }
    return runs
}

async function startRelease(
    receipt: InstallationReceipt,
    dataSetId: string | undefined,
    withSharedArtifacts: boolean,
): Promise<ReleaseRun> {
    if (!dataSetId) {
        return { started: false, segment: ' · Freigabe NICHT gestartet: Antwort trägt keine Datensatz-ID' }
    }
    // Outside the try block: a missing session ends in a redirect, which
    // travels as an exception and must not read as an unreachable backend.
    const accessToken = await getAccessToken()
    const idsOf = (artifactType: string) =>
        withSharedArtifacts
            ? (receipt.artifacts ?? []).flatMap((line) => (line.artifactType === artifactType && line.shellId ? [line.shellId] : []))
            : []
    try {
        const start = await releaseUseCase(platformApi(accessToken), {
            dataSetId,
            structureIds: idsOf('DATA_STRUCTURE'),
            sourceIds: idsOf('DATA_SOURCE'),
        })
        if (start.state === 'refused') {
            const { status, statusText, text } = start.answer
            return { started: false, segment: describeReleaseFailure(start.step, status, statusText, text) }
        }
        return { started: true, dataSetId, released: start.released }
    } catch (error) {
        return { started: false, segment: ` · Freigabe NICHT gestartet: Portal-Backend nicht erreichbar (${reasonOf(error)})` }
    }
}

/**
 * Waits for the end of the saga a started release set off, and says how it ended: provisioned,
 * reverted by the platform, or still running at the time limit.
 */
async function finishRelease(run: ReleaseRun): Promise<{ completed: boolean; segment: string }> {
    if (!run.started) return { completed: false, segment: run.segment }
    const accessToken = await getAccessToken()
    let outcome: SagaOutcome
    try {
        outcome = await awaitRelease(platformApi(accessToken), run.dataSetId, RELEASE_WAIT)
    } catch (error) {
        return { completed: false, segment: ` · Freigabe gestartet, ihr Ende ließ sich NICHT abfragen (${reasonOf(error)})` }
    }
    const { versions, sources } = run.released
    const released = `${versions} Strukturversion(en), ${sources} Quelle(n) und den Datensatz freigegeben`
    switch (outcome) {
        case 'completed':
            return { completed: true, segment: ` · Freigabe abgeschlossen: ${released}, die Plattform hat Speicher, Pipelines und APIs eingerichtet` }
        case 'failed':
            return {
                completed: false,
                segment: ` · Freigabe NICHT abgeschlossen: ${released}, aber die Plattform hat das Einrichten abgebrochen und den Datensatz zurückgesetzt (bereit zur Freigabe). Die Ursache steht im Log des Portal-Backends („Saga CREATE failed“)`,
            }
        case 'pending':
            return {
                completed: false,
                segment: ` · Freigabe gestartet: ${released}. Nach ${RELEASE_WAIT.timeoutMs / 1000} s richtet die Plattform Speicher und Pipelines noch ein`,
            }
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
 *
 * The receipt is the platform's record of what it just created; the streams
 * take their names and origin from it.
 */
async function activateDemoStreams(entry: UseCaseEntry, receipt: InstallationReceipt): Promise<string> {
    if (!isSimulatorConfigured()) {
        return ' · Demo-Daten NICHT aktiviert: SIMULATOR_API_URL ist nicht konfiguriert'
    }
    const installationId = receipt.id
    if (!installationId) {
        return ' · Demo-Daten NICHT aktiviert: Antwort trägt keine Installations-ID'
    }
    try {
        // SIMULATOR_BROKER_URL overrides the package's broker for the simulator
        // only — needed when the simulator runs outside the docker network and
        // the container-name URL does not resolve for it.
        const planned = planSimulations(entry, installationId, process.env.SIMULATOR_BROKER_URL, receipt)
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
 * Hands the use case's dashboards to the platform: one dashboard of the
 * installed dataset per member, with the member's Superset export as its
 * bundle (lib/installed-dashboards). The platform's saga creates each one in
 * Superset and imports its bundle, so the marketplace needs no Superset
 * account for it.
 *
 * Says only what went wrong. A dashboard the platform took is reported after
 * the release, with its link (reportDashboards).
 */
async function registerDashboards(
    entry: UseCaseEntry,
    dataSetIdOf: (key: string) => string | undefined,
    released: boolean,
): Promise<string> {
    const dashboards = entry.bundle.dashboards ?? []
    if (dashboards.length === 0) return ''
    // Outside the try blocks, as in startRelease: a missing session ends in a
    // redirect, which must not read as a refused dashboard.
    const accessToken = await getAccessToken()
    let refusals = ''
    for (const dashboard of dashboards) {
        const dataSetId = dataSetIdOf(dashboard.dataSet)
        if (!dataSetId) {
            refusals += ` · Dashboard ${dashboard.file} NICHT angelegt: Antwort trägt keinen Datensatz „${dashboard.dataSet}“`
            continue
        }
        let creation: DashboardCreation
        try {
            creation = dashboardCreation(dashboard, released)
        } catch (error) {
            refusals += ` · Dashboard ${dashboard.file} NICHT angelegt: ${reasonOf(error)}`
            continue
        }
        try {
            const response = await fetch(
                `${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/datasets/${encodeURIComponent(dataSetId)}/visualizations`,
                {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(creation),
                    cache: 'no-store',
                },
            )
            if (response.ok) continue
            const { detail, reason } = readFailure(await response.text().catch(() => ''))
            refusals += ` · Dashboard „${creation.name}“ NICHT angelegt: ${response.status} ${detail ?? reason ?? response.statusText}`
        } catch (error) {
            refusals += ` · Dashboard „${creation.name}“ NICHT angelegt: Portal-Backend nicht erreichbar (${reasonOf(error)})`
        }
    }
    return refusals
}

/**
 * Where each dashboard of the dataset stands after the release, read back
 * from the platform: its Superset link once the saga has created it there, or
 * what it still waits for.
 */
async function reportDashboards(dataSetIds: (string | undefined)[], releaseCompleted: boolean): Promise<string> {
    const accessToken = await getAccessToken()
    let steps = ''
    for (const dataSetId of dataSetIds) {
        if (!dataSetId) continue
        const dashboards = await fetchInstalledDashboards(dataSetId, accessToken)
        steps += dashboards.map((dashboard) => ` · ${dashboardStep(dashboard, releaseCompleted)}`).join('')
    }
    return steps
}

/** One dashboard as a step of the install summary (installSteps turns a URL into a link). */
function dashboardStep({ title, externalId, url }: InstalledDashboardLink, releaseCompleted: boolean): string {
    if (url) return `Dashboard „${title}“: ${url}`
    if (externalId) return `Dashboard „${title}“ in Superset angelegt (ohne SUPERSET_PUBLIC_URL kein Link)`
    if (releaseCompleted) {
        return `Dashboard „${title}“ NICHT in Superset angelegt, obwohl die Freigabe abgeschlossen ist. Die Ursache steht im Log des Config-Adapters`
    }
    return `Dashboard „${title}“ im Portal angelegt. Superset übernimmt es, sobald der Datensatz freigegeben ist`
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
        `${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/use-cases`,
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
        `${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/use-cases/${encodeURIComponent(installationId)}`,
        {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: 'no-store',
        },
    )

    if (response.status === 204) {
        // Superset needs no sweep here. The platform removes a dataset's
        // dashboards from Superset when it deletes the dataset (the DATASET_DELETE
        // saga), and a dataset that was never released has none there.
        const cleanup = await removeDemoStreams(installationId)
        revalidatePath('/installed')
        revalidatePath('/datastructures')
        revalidatePath('/use-cases')
        revalidatePath('/(authenticated)/use-cases/[publisher]/[slug]', 'page')
        return {
            status: 'uninstalled',
            detail: `Deinstalliert${cleanup}`,
            httpStatus: 204,
        }
    }

    const failure = describeUninstallFailure(
        response.status,
        response.statusText,
        await response.text().catch(() => ''),
    )
    return { ...failure, httpStatus: response.status }
}
