'use server'

import { useCaseSlugPattern } from '@/lib/catalog/use-case-id'
import { applyCatalogEntry, buildCatalogEntry, catalogInputFromManifest } from '@/lib/export/catalog-entry'
import {
    bundleBranch,
    catalogBranch,
    exportConfig,
    exportReadiness,
    packageDir,
    removalBranch,
    SHARING_NOT_SET_UP,
    thisInstance,
    type ExportConfig,
    type ExportTarget,
} from '@/lib/export/config'
import {
    clientFor,
    currentUser,
    getProject,
    GitLabError,
    gitlabMessage,
    HeldBranchError,
    listMergeRequestsBy,
    listOpenMergeRequests,
    listTree,
    openMergeRequest,
    parseProjectUrl,
    type GitLabClient,
    type GitLabProject,
} from '@/lib/export/gitlab'
import { entryRefusal, packageRefusal, removalDeclineShown } from '@/lib/export/declines'
import { SHARE_READS } from '@/lib/export/share-cache'
import { DELETION_SCOPES, readDeletion, runDeletion, type DeletionPlan, type DeletionResult, type DeletionScope } from '@/lib/export/share-deletion'
import { shareSourceLine, shareSourceOf } from '@/lib/export/merge-request-text'
import {
    busyRefusal,
    changeNoteProblem,
    entryUsedUpRefusal,
    followedHere,
    followsLine,
    followsRefOf,
    openSharesOf,
    parseFollows,
    proposedHere,
    proposedVersionsIn,
    versionBelow,
    whatChangedRefusal,
    type FollowedDecline,
    type FollowsRef,
    type OpenShare,
} from '@/lib/export/new-version'
import { aboveAll, isNewerVersion, nextPatch, takenOutBlocker, takenOutFact } from '@/lib/export/share-stages'
import { mergeRequestRef } from '@/lib/export/share-state'
import { parseExportMetadata } from '@/lib/export/metadata'
import { getCatalogSummaries } from '@/lib/catalog/source'
import { catalogEntryPath, matchesEntryPath } from '@/lib/use-case-catalog/path'
import { checkPackage } from '@/lib/export/package-check'
import { PortalReadError, readUseCase, type InstanceSnapshot } from '@/lib/export/portal-reader'
import {
    catalogFloor,
    catalogStatusIn,
    inspectBundle,
    inspectCatalog,
    lazyAccount,
    presentRequests,
    readBundleStatus,
    readCatalogDecline,
    readCatalogStatus,
    readDecline,
    readVersionCatalog,
    type BundleStatus,
    type BundleVerification,
    type CatalogInspection,
    type CatalogStatus,
} from '@/lib/export/status'
import { isUnnamedMapping, mappingTitle, transformSnapshot, type ExportedPackage, type ExportOptions } from '@/lib/export/transform'
import { datasourceHref } from '@/lib/portal-links'
import { demoSources, simulationMembers, type DemoSource } from '@/lib/export/simulations'
import { getSimulation, isSimulatorConfigured, listSimulations, SimulatorError, type SimulationDetail } from '@/lib/simulator/client'
import { simulatorUiUrl } from '@/lib/simulator/ui-links'
import { getAccessToken, requireSession } from '@/lib/session'
import { fetchShareRight, proposerName, shareRefusal } from '@/lib/export/share-permission'

export type ExportIntent = 'preview' | 'bundle' | 'catalog' | 'status'

export interface PreviewSummary {
    packageDir: string
    branch: string
    files: { path: string; bytes: number }[]
    manifest: ExportedPackage['manifest']
    identities: ExportedPackage['identities']
    stripped: ExportedPackage['stripped']
    parameters: ExportedPackage['parameters']
    warnings: string[]
    /** Package validator failures; a merge request is refused while any exist. */
    errors: string[]
    demo: { scenarios: number; streams: number }
}

export interface ExportActionResult {
    intent: ExportIntent
    status: 'ok' | 'error' | 'invalid' | 'unconfigured' | 'forbidden' | 'already-open' | 'not-merged' | 'unchanged' | 'declined'
    detail: string
    preview?: PreviewSummary
    mrUrl?: string
    bundle?: BundleStatus
    catalog?: CatalogStatus
    /** Refused beside another open proposal; the page then reads its listing again. */
    busy?: boolean
    follows?: FollowedDecline
}

interface ExportForm {
    intent: ExportIntent
    datasetId: string
    targetKey: string
    demoStreams: string[]
    options: Omit<ExportOptions, 'provenance' | 'simulations'>
    follows?: FollowsRef & { note: string }
}

/** Cached reads (`SHARE_READS`); lists of proposals and reads at a branch stay fresh. */
function shareClient(url: string, token: string): GitLabClient {
    return { ...clientFor(url, token), cache: SHARE_READS }
}

const SLUG = useCaseSlugPattern
const SEGMENT = /^[a-z0-9]{2,40}$/
const VERSION = /^\d+\.\d+\.\d+$/

function field(formData: FormData, name: string): string {
    const value = formData.get(name)
    return typeof value === 'string' ? value.trim() : ''
}

function parseForm(formData: FormData): ExportForm | string {
    const intentRaw = field(formData, 'intent')
    const intent: ExportIntent =
        intentRaw === 'bundle' || intentRaw === 'catalog' || intentRaw === 'status' ? intentRaw : 'preview'
    const datasetId = field(formData, 'datasetId')
    if (!datasetId) return 'Bitte einen Datensatz auswählen.'
    const targetKey = field(formData, 'targetKey')
    const publisher = field(formData, 'publisher').toLowerCase()
    if (!SEGMENT.test(publisher)) return 'Herausgeber-Kürzel: 2 bis 40 Kleinbuchstaben oder Ziffern.'
    const slug = field(formData, 'slug').toLowerCase()
    if (!SLUG.test(slug)) return 'Kurzname: 2 bis 60 Kleinbuchstaben, Ziffern oder Bindestriche, nicht am Anfang oder Ende.'
    const version = field(formData, 'version') || '1.0.0'
    if (!VERSION.test(version)) return 'Version bitte als drei Zahlen mit Punkt, zum Beispiel 1.0.0.'
    const domain = field(formData, 'domain').toLowerCase() || 'general'
    if (!SEGMENT.test(domain)) return 'Fachgebiet: 2 bis 40 Kleinbuchstaben oder Ziffern.'
    const displayName = field(formData, 'displayName')
    if (!displayName) return 'Name im Katalog fehlt.'
    const description = field(formData, 'description')
    if (!description) return 'Kurzbeschreibung fehlt.'
    const maintainer = field(formData, 'maintainer')
    if (!maintainer) return 'Herausgeber fehlt.'
    const license = field(formData, 'license') || 'EUPL-1.2'
    const keywords = field(formData, 'keywords')
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean)
    const metadata = parseExportMetadata(field(formData, 'catalogMetadata'))
    if (metadata.error) return metadata.error
    const demoStreams = parseDemoStreams(field(formData, 'demoStreams'))
    if (!demoStreams) return 'Demo-Daten: ungültige Auswahl.'
    // Checked from the preview on, so the Steckbrief asks for the change note, not the last step.
    const follows = parseFollows(field(formData, 'follows'))
    if (follows === null) return 'Die Angabe zum nicht angenommenen Vorschlag ist ungültig - bitte die Seite neu laden.'
    const changeNote = field(formData, 'changeNote')
    const noteProblem = follows && (intent === 'preview' || intent === 'bundle') ? changeNoteProblem(changeNote) : undefined
    if (noteProblem) return noteProblem
    return {
        intent,
        datasetId,
        targetKey,
        demoStreams,
        options: { publisher, slug, version, domain, displayName, description, maintainer, license, keywords, metadata: metadata.data },
        ...(follows ? { follows: { ...follows, note: changeNote } } : {}),
    }
}

function parseDemoStreams(raw: string): string[] | undefined {
    if (!raw) return []
    try {
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed) || parsed.length > 200) return undefined
        return parsed.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 300) ? parsed : undefined
    } catch {
        return undefined
    }
}

/** The list carries no scenarios, so each is read; the simulator caps registrations at 50. */
async function readSimulations(): Promise<{ details: SimulationDetail[]; problem?: string }> {
    if (!isSimulatorConfigured()) return { details: [], problem: 'Der Simulator ist an diese Instanz nicht angebunden.' }
    try {
        const listed = await listSimulations()
        const details = await Promise.all(listed.map((simulation) => getSimulation(simulation.id)))
        return { details: details.filter((detail): detail is SimulationDetail => !!detail) }
    } catch (error) {
        if (!(error instanceof SimulatorError)) throw error
        return { details: [], problem: `Der Simulator antwortet nicht: ${error.message}` }
    }
}

function findTarget(targets: ExportTarget[], key: string): ExportTarget | undefined {
    return targets.find((t) => t.key === key) ?? (targets.length === 1 ? targets[0] : undefined)
}

async function buildPackage(
    accessToken: string,
    form: ExportForm,
    exportedBy: string | undefined,
): Promise<ExportedPackage> {
    const snapshot = await readUseCase(accessToken, form.datasetId)
    const demo = form.demoStreams.length ? await readSimulations() : { details: [] }
    const { simulations, warnings } = simulationMembers(snapshot, demo.details, new Set(form.demoStreams))
    const pkg = transformSnapshot(snapshot, {
        ...form.options,
        simulations,
        provenance: {
            datasetId: snapshot.dataset.id,
            datasetName: snapshot.dataset.name,
            instance: thisInstance(),
            exportedBy,
            exportedAt: new Date().toISOString().slice(0, 10),
        },
    })
    const problems = demo.problem ? [`Demo-Daten fehlen im Paket: ${demo.problem}`] : []
    return { ...pkg, warnings: [...pkg.warnings, ...problems, ...warnings] }
}

function summarise(pkg: ExportedPackage, target: ExportTarget | undefined, form: ExportForm): PreviewSummary {
    const dir = target ? packageDir(target, form.options.slug) : form.options.slug
    return {
        packageDir: dir,
        branch: bundleBranch(form.options.slug, form.options.version),
        files: Object.entries(pkg.files)
            .map(([path, content]) => ({ path: `${dir}/${path}`, bytes: Buffer.byteLength(content, 'utf8') }))
            .sort((a, b) => a.path.localeCompare(b.path)),
        manifest: pkg.manifest,
        identities: pkg.identities,
        stripped: pkg.stripped,
        parameters: pkg.parameters,
        warnings: pkg.warnings,
        errors: checkPackage(pkg.files),
        demo: {
            scenarios: pkg.manifest.members.simulations?.length ?? 0,
            streams: (pkg.manifest.members.simulations ?? []).reduce((count, member) => {
                const document = JSON.parse(pkg.files[`core-ir/${member.file}`]) as { streams?: unknown[] }
                return count + (Array.isArray(document.streams) ? document.streams.length : 1)
            }, 0),
        },
    }
}

function mergeRequestBody(
    preview: PreviewSummary,
    form: ExportForm,
    requestedBy: string,
    catalogConfigured: boolean,
    removed: string[],
): string {
    const identityRows = preview.identities
        .map((i) => `| ${i.kind} | ${i.title} | \`${i.to}\` | ${i.kept ? 'kept' : 'derived'} |`)
        .join('\n')
    const strippedRows = preview.stripped.length
        ? [...new Set(preview.stripped.map((s) => `- \`${s.file}\` → \`${s.field}\` (${s.reason})`))].join('\n')
        : '- nothing had to be stripped'
    const warningRows = preview.warnings.length ? preview.warnings.map((w) => `- ${w}`).join('\n') : '- none'
    return [
        `Proposed by the Open Urban Apps marketplace on behalf of **${requestedBy}**.`,
        '',
        // Under the first line, as the listing reads the proposer from that one.
        ...(form.follows ? [followsLine(form.follows, form.follows.note, requestedBy), ''] : []),
        `## ${preview.manifest.displayName} ${preview.manifest.version}`,
        '',
        preview.manifest.description,
        '',
        '## What this adds',
        '',
        `- \`${preview.packageDir}/\` (${preview.files.length} files) — a CORE-IR use-case package exported from a running instance`,
        `- id \`${preview.manifest.id}\`, license ${preview.manifest.license}, maintained by ${preview.manifest.maintainer}`,
        ...(removed.length
            ? [`- removes ${removed.length === 1 ? '1 file' : `${removed.length} files`} below \`core-ir/\` that version ${preview.manifest.version} no longer contains: ${removed.map((path) => `\`${path}\``).join(', ')}`]
            : []),
        '',
        '## Identities',
        '',
        '| kind | member | logical URN | origin |',
        '|---|---|---|---|',
        identityRows,
        '',
        '## Credentials stripped on export',
        '',
        strippedRows,
        '',
        preview.parameters.length
            ? `Declared as install parameters instead: ${preview.parameters.map((p) => `\`${p.file}\` (${p.fields.join(', ')})`).join('; ')}.`
            : '',
        '',
        '## Warnings from the export',
        '',
        warningRows,
        '',
        '## How to check',
        '',
        '```sh',
        `cd ${preview.packageDir} && python3 ci/validate-bundle.py`,
        '```',
        '',
        '## After merging',
        '',
        catalogConfigured
            ? 'Nothing is listed yet. The marketplace offers "Katalog-Eintrag vorschlagen" once this package is on the base branch — the catalogue entry pins the merged commit, which is why it cannot be part of this merge request.'
            : 'Nothing is listed yet. Add a catalogue entry pinned to the merged commit to make the package installable.',
        '',
        '---',
        `Branch \`${preview.branch}\` · exported via the marketplace export`,
        `Publisher \`${form.options.publisher}\`, domain \`${form.options.domain}\``,
        '',
        // Hidden on GitLab; the share pages read it back.
        shareSourceLine({ kind: 'dataset', id: form.datasetId, instance: thisInstance() }),
    ].join('\n')
}

async function addressAlreadyTaken(id: string): Promise<string[]> {
    const { publisher, slug } = catalogEntryPath(id)
    try {
        const taken = (await getCatalogSummaries('usecase')).find(
            (row) => row.id !== id && matchesEntryPath(row.id, publisher, slug),
        )
        if (!taken) return []
        return [
            `Im Katalog ist die Adresse /use-cases/${publisher}/${slug} schon belegt („${taken.displayName}“). ` +
                'Der Eintrag würde abgelehnt - bitte einen anderen Kurznamen wählen.',
        ]
    } catch {
        return []
    }
}

export async function exportAction(
    _prev: ExportActionResult | null,
    formData: FormData,
): Promise<ExportActionResult> {
    const session = await requireSession()
    const requestedBy = proposerName(session.user)
    const parsed = parseForm(formData)
    const intent: ExportIntent = typeof parsed === 'string' ? 'preview' : parsed.intent
    if (typeof parsed === 'string') {
        return { intent, status: 'invalid', detail: parsed }
    }
    const form = parsed
    const config = exportConfig()
    const target = findTarget(config.targets, form.targetKey)
    const id = `urn:${form.options.publisher}:usecase:${form.options.slug}`

    try {
        if (form.intent === 'preview') {
            const accessToken = await getAccessToken()
            const pkg = await buildPackage(accessToken, form, requestedBy)
            const preview = summarise(pkg, target, form)
            preview.warnings = [...preview.warnings, ...(await addressAlreadyTaken(id))]
            return {
                intent: 'preview',
                status: preview.errors.length ? 'invalid' : 'ok',
                detail: preview.errors.length
                    ? `Das Paket würde die Paketprüfung nicht bestehen (${preview.errors.length} Fehler) - siehe unten.`
                    : `${preview.files.length} Dateien, ${preview.identities.length} Kennungen, ${preview.stripped.length} entfernte Zugangsdaten.`,
                preview,
            }
        }

        if (form.intent === 'bundle' || form.intent === 'catalog') {
            const refusal = shareRefusal(await fetchShareRight())
            if (refusal) return { intent: form.intent, status: 'forbidden', detail: refusal }
        }
        const readiness = exportReadiness(config)
        if (readiness !== 'ready' || !target) {
            return {
                intent: form.intent,
                status: 'unconfigured',
                detail:
                    readiness === 'missing-targets'
                        ? (config.targetsError ?? 'Kein Ablageort eingerichtet (EXPORT_TARGET_REPOS).')
                        : readiness === 'missing-token'
                          ? 'Kein Zugang zu GitLab hinterlegt (EXPORT_REPO_TOKEN) - die Vorschau geht, Einreichen nicht.'
                          : 'Bitte einen Ablageort wählen.',
            }
        }
        const token = config.token as string
        const client = shareClient(target.url, token)

        if (form.intent === 'status') {
            const bundle = await readBundleStatus(client, target, form.options.slug, form.options.version, id)
            const catalog = await readCatalogStatus(
                config.catalog ? shareClient(config.catalog.url, token) : client,
                config.catalog,
                form.options.slug,
                form.options.version,
                id,
            )
            return { intent: 'status', status: hasDecline(bundle, catalog) ? 'declined' : 'ok', detail: statusLine(bundle, catalog), bundle, catalog }
        }

        if (form.intent === 'bundle') {
            // Before the expensive build. An unreadable "no" throws rather than refusing on a guess.
            const current = await readBundleStatus(client, target, form.options.slug, form.options.version, id, { unreadable: 'throw' })
            if (current.state === 'on-base') {
                return {
                    intent: 'bundle',
                    status: 'unchanged',
                    detail: `Version ${form.options.version} ist schon angenommen - Änderungen gehen jetzt nur noch mit einer neuen Version.`,
                    bundle: current,
                }
            }
            if (current.state === 'mr-open') {
                return {
                    intent: 'bundle',
                    status: 'already-open',
                    detail: `Für Version ${form.options.version} ist schon ein Vorschlag in Prüfung${proposalRef(current.mrUrl)}.`,
                    mrUrl: current.mrUrl,
                    bundle: current,
                }
            }
            const folderRefusal = folderRefusalOf(current, id, form.options.slug, form.options.version)
            if (folderRefusal) return { intent: 'bundle', status: 'invalid', detail: folderRefusal, bundle: current }
            const catalogue = config.catalog
                ? await inspectCatalog(shareClient(config.catalog.url, token), config.catalog, form.options.slug, form.options.version, id)
                : undefined
            const usedUp = catalogue && catalogRefusalOf(form.options.version, catalogue)
            if (usedUp) return { intent: 'bundle', status: 'invalid', detail: usedUp, bundle: current, catalog: catalogue.status }
            // After the checks above, so the suggested version is above everything accepted and listed.
            // An entry's "no" counts whoever proposed it: that number accepted again would never get an entry.
            const entryNo = followedHere(form.options.version, 'entry', catalogue?.status.state === 'declined' ? catalogue.status.declined : undefined, undefined, undefined)
            const usedUpBy = current.declined ?? entryNo?.decline
            if (usedUpBy) {
                const used = await proposedVersionsOf(client, target, form.options.slug)
                const instead = aboveAll([form.options.version, ...used, ...(catalogue?.floor ? [catalogue.floor] : [])])
                return {
                    intent: 'bundle',
                    status: 'invalid',
                    detail: entryNo && !current.declined ? entryUsedUpRefusal(entryNo, instead) : packageRefusal(form.options.version, usedUpBy, instead),
                    mrUrl: usedUpBy.mrUrl,
                    bundle: current,
                    ...(catalogue ? { catalog: catalogue.status } : {}),
                }
            }
            if (form.follows && !proposalOfHere(form.follows.url, [target.url, ...(config.catalog ? [config.catalog.url] : [])])) {
                return { intent: 'bundle', status: 'invalid', detail: 'Die Angabe zum nicht angenommenen Vorschlag ist ungültig - bitte die Seite neu laden.' }
            }
            // A dataset with another proposal open is greyed out in „Auswählen“; this catches a link or a race.
            const project = await getProject(client, parseProjectUrl(target.url).projectPath)
            const open = await openShareOf(config, token, form.datasetId)
            if (open) return { intent: 'bundle', status: 'invalid', detail: busyRefusal(open), mrUrl: open.url, busy: true, bundle: current }
            // The refusal carries a "no" the page did not know, so the Steckbrief asks what changed.
            const followed = await followedOnServer(client, project, config, token, form.options.slug, form.options.version, id, catalogue)
            if (followed && !form.follows) return { intent: 'bundle', status: 'invalid', detail: whatChangedRefusal(followed), follows: followed, bundle: current }
            // The "no" as GitLab tells it, where found here; else the page's, checked above.
            const proposing: ExportForm = followed && form.follows ? { ...form, follows: { ...followsRefOf(followed), note: form.follows.note } } : form
            const accessToken = await getAccessToken()
            const pkg = await buildPackage(accessToken, form, requestedBy)
            const preview = summarise(pkg, target, form)
            if (preview.errors.length) {
                return {
                    intent: 'bundle',
                    status: 'invalid',
                    detail: `Nicht eingereicht: das Paket würde die Paketprüfung nicht bestehen (${preview.errors.length} Fehler).`,
                    preview,
                }
            }
            const dir = packageDir(target, form.options.slug)
            const existing = new Set(await listTree(client, project.id, dir, target.baseBranch))
            const files = Object.fromEntries(
                Object.entries(pkg.files).map(([path, content]) => [`${dir}/${path}`, content]),
            )
            // Leftover files would fail the repository's check; only core-ir/ goes, as the export writes it in full
            // and the README, check script or a reviewer's files next to it stay.
            const stale = [...existing].filter((path) => path.startsWith(`${dir}/core-ir/`) && !Object.hasOwn(files, path)).sort()
            const outcome = await openMergeRequest(client, {
                upstream: project,
                baseBranch: target.baseBranch,
                branch: preview.branch,
                title: `Export use case: ${form.options.displayName} ${form.options.version}`,
                description: mergeRequestBody(preview, proposing, requestedBy, Boolean(config.catalog), stale),
                files,
                existingPaths: existing,
                ...(stale.length ? { deletedPaths: stale } : {}),
                // „Erneut einreichen“ after „Entfernt“: a "no" from before the removal holds no branch.
                restartedBy: removalBranch(form.options.slug, form.options.version),
            })
            if (outcome.status === 'already-open') {
                return {
                    intent: 'bundle',
                    status: 'already-open',
                    detail: `Für Version ${form.options.version} ist schon ein Vorschlag in Prüfung (!${outcome.iid}).`,
                    mrUrl: outcome.url,
                    preview,
                }
            }
            return {
                intent: 'bundle',
                status: 'ok',
                detail: `Zur Prüfung eingereicht (Vorschlag !${outcome.iid}). Sobald das Katalog-Team das Paket angenommen hat, schlägst du unter „In Arbeit“ den Katalog-Eintrag vor.`,
                mrUrl: outcome.url,
                preview,
                ...(catalogue ? { catalog: catalogue.status } : {}),
            }
        }

        return await proposeCatalog(config, target, token, form.options.slug, form.options.version, id, requestedBy, form.datasetId)
    } catch (error) {
        if (error instanceof PortalReadError) {
            return { intent: form.intent, status: 'error', detail: `Portal-Backend: ${error.message}` }
        }
        if (error instanceof GitLabError) {
            return { intent: form.intent, status: 'error', detail: gitlabMessage(error) }
        }
        throw error
    }
}

/** None where GitLab cannot be read: the refusal still names a version above its own. */
async function proposedVersionsOf(client: GitLabClient, target: ExportTarget, slug: string): Promise<string[]> {
    try {
        const [project, bot] = await Promise.all([getProject(client, parseProjectUrl(target.url).projectPath), currentUser(client)])
        return proposedVersionsIn(await listMergeRequestsBy(client, project.id, bot.id), slug, bot.id)
    } catch (error) {
        if (error instanceof GitLabError) return []
        throw error
    }
}

const withoutSlash = (url: string) => url.replace(/\/+$/, '').toLowerCase()

function proposalOfHere(url: string, projects: string[]): boolean {
    return projects.some((project) => url.toLowerCase().startsWith(`${withoutSlash(project)}/-/merge_requests/`))
}

/** Asks the account per GitLab, as a token is someone else on another host. */
async function openShareOf(config: ExportConfig, token: string, datasetId: string): Promise<OpenShare | undefined> {
    const instance = thisInstance()
    const projects = new Map([...config.targets.map((target) => target.url), ...(config.catalog ? [config.catalog.url] : [])].map((url) => [withoutSlash(url), url]))
    const found = await Promise.all(
        [...projects.values()].map(async (url) => {
            const where = shareClient(url, token)
            const project = await getProject(where, parseProjectUrl(url).projectPath)
            const [requests, bot] = await Promise.all([listOpenMergeRequests(where, project.id), currentUser(where)])
            return openSharesOf(requests, datasetId, bot.id, instance)
        }),
    )
    return found.flat()[0]
}

/** Server side of `followedDecline`; `inspected` spares reading the catalogue index twice. */
async function followedOnServer(
    client: GitLabClient,
    project: GitLabProject,
    config: ExportConfig,
    token: string,
    slug: string,
    version: string,
    id: string,
    inspected?: CatalogInspection,
): Promise<FollowedDecline | undefined> {
    const bot = await currentUser(client)
    const requests = await listMergeRequestsBy(client, project.id, bot.id)
    const instance = thisInstance()
    const before = versionBelow(proposedHere(requests, slug, bot.id, instance), version)
    if (!before) return undefined
    // Read as `inspectBundle` reads it (since the version last started over), from the listing at hand.
    const branch = (name: string) => requests.filter((mr) => mr.source_branch === name)
    const removals = branch(removalBranch(slug, before))
    const packageNo = await readDecline(client, project.id, presentRequests(branch(bundleBranch(slug, before)), removals), async () => bot)
    if (packageNo) return followedHere(before, 'package', packageNo, requests.find((mr) => mr.iid === packageNo.iid)?.description, instance)
    if (!config.catalog) return undefined
    const catalogClient = shareClient(config.catalog.url, token)
    const catalogProject = await getProject(catalogClient, parseProjectUrl(config.catalog.url).projectPath)
    const catalogue = await readVersionCatalog(catalogClient, catalogProject.id, config.catalog, slug, before, false, lazyAccount(catalogClient), inspected?.read)
    const declined = await readCatalogDecline(catalogClient, catalogProject.id, catalogue, id, lazyAccount(catalogClient))
    // Listed or taken out since, it is no "no" any more.
    const status = catalogStatusIn(catalogue, slug, before, id, declined)
    if (status.state !== 'declined') return undefined
    const turnedDown = catalogue.requests?.find((mr) => mr.iid === status.declined?.iid)
    return followedHere(before, 'entry', status.declined, turnedDown?.description, instance)
}

function proposalRef(mrUrl: string | undefined): string {
    const ref = mergeRequestRef(mrUrl)
    return ref ? ` (${ref})` : ''
}

/** The same version again is fine: it never reached the base branch, as `on-base` was refused before. */
function folderRefusalOf(onBranch: BundleStatus, id: string, slug: string, version: string): string | undefined {
    if (onBranch.reason !== 'other-version' || !onBranch.onBase) return undefined
    if (onBranch.onBase.id !== id) {
        return `Unter dem Kurznamen „${slug}“ liegt im Ablageort schon ein anderes Paket. Bitte wähle einen anderen Kurznamen.`
    }
    const accepted = onBranch.onBase.version
    if (VERSION.test(accepted) && !isNewerVersion(version, accepted)) {
        return `Angenommen ist schon Version ${accepted}. Eine neue Version muss höher sein, zum Beispiel ${nextPatch(accepted)}.`
    }
    return undefined
}

/** Listed or taken out at this version or higher: either way it is used up. */
function catalogRefusalOf(version: string, { status, floor }: CatalogInspection): string | undefined {
    if (!floor || isNewerVersion(version, floor)) return undefined
    const higher = `Eine neue Version muss höher sein als ${floor}, zum Beispiel ${nextPatch(floor)}.`
    if (status.state === 'listed') return `Version ${version} steht schon im Katalog. ${higher}`
    if (status.takenOut) return `Version ${floor} war schon im Katalog. ${higher}`
    return `Im Katalog steht schon Version ${floor}. ${higher}`
}

// Built from the merged manifest, not a form: the entry lists what the review saw, and works days later.
// Refused unless the package directory on the base branch has the tree id the export's proposal brought.
async function proposeCatalog(
    config: ExportConfig,
    target: ExportTarget,
    token: string,
    slug: string,
    version: string,
    expectedId: string | undefined,
    requestedBy: string,
    datasetId?: string,
): Promise<ExportActionResult> {
    if (!config.catalog) {
        return { intent: 'catalog', status: 'unconfigured', detail: CATALOG_NOT_SET_UP }
    }
    const { status: bundle, manifestRaw, merged } = await inspectBundle(
        shareClient(target.url, token),
        target,
        slug,
        version,
        expectedId,
    )
    if (bundle.state !== 'on-base' || !bundle.sha || !manifestRaw) {
        return {
            intent: 'catalog',
            status: 'not-merged',
            detail:
                bundle.state === 'mr-open'
                    ? 'Das Paket ist noch in Prüfung. Der Katalog-Eintrag kann erst auf das angenommene Paket zeigen.'
                    : sentenceOf(bundle.detail ?? `Im Ablageort liegt noch kein angenommenes Paket „${slug}“ in Version ${version}`),
            bundle,
        }
    }
    // Not listed while its removal is proposed: the reviewers decide on that first.
    if (bundle.removal?.state === 'opened') {
        const removal = mergeRequestRef(bundle.removal.mrUrl)
        return {
            intent: 'catalog',
            status: 'not-merged',
            detail: `Für diese Version ist das Entfernen vorgeschlagen (${removal ? `Vorschlag ${removal}` : 'Vorschlag bei GitLab'}). Einen Katalog-Eintrag gibt es erst, wenn das Katalog-Team das Entfernen ablehnt.`,
            mrUrl: bundle.removal.mrUrl,
            bundle,
        }
    }
    if (bundle.verification?.state !== 'verified') {
        return {
            intent: 'catalog',
            status: 'invalid',
            detail: verificationRefusal(bundle.verification),
            bundle,
        }
    }

    const catalogClient = shareClient(config.catalog.url, token)
    const catalogProject = await getProject(catalogClient, parseProjectUrl(config.catalog.url).projectPath)
    const catalogue = await readVersionCatalog(catalogClient, catalogProject.id, config.catalog, slug, version, false)
    const packageId = bundle.packageId ?? expectedId ?? ''
    const declined = await readCatalogDecline(catalogClient, catalogProject.id, catalogue, packageId, lazyAccount(catalogClient), 'throw')
    // The catalogue team's "no" is not undone from here, neither by a new proposal nor by an open one.
    const catalog = catalogStatusIn(catalogue, slug, version, packageId, declined)
    // The reading goes along, so the page drops its button at once.
    if (catalog.state === 'declined' && catalog.declined) {
        const used = await proposedVersionsOf(shareClient(target.url, token), target, slug)
        const floor = catalogFloor(catalogue, packageId)
        return {
            intent: 'catalog',
            status: 'invalid',
            detail: entryRefusal(version, catalog.declined, aboveAll([version, ...used, ...(floor ? [floor] : [])])),
            mrUrl: catalog.declined.mrUrl,
            bundle,
            catalog,
        }
    }
    if (catalog.state === 'withdrawn' || catalog.bringsBack) {
        const open = catalog.bringsBack ? mergeRequestRef(catalog.mrUrl) : undefined
        return {
            intent: 'catalog',
            status: 'invalid',
            detail:
                `${takenOutFact(catalog.takenOut ?? { version })} ${takenOutBlocker(catalog.takenOut, version)}` +
                (catalog.bringsBack
                    ? ` Der offene Katalog-Vorschlag${open ? ` ${open}` : ''} würde den herausgenommenen Eintrag zurückbringen - zieh den Vorschlag unter „In Arbeit“ zurück.`
                    : ''),
            ...(catalog.mrUrl ? { mrUrl: catalog.mrUrl } : {}),
            bundle,
            catalog,
        }
    }
    const dir = packageDir(target, slug)
    const input = catalogInputFromManifest(manifestRaw, { repoUrl: target.url, path: dir, commitSha: bundle.sha })
    if (typeof input === 'string') {
        return { intent: 'catalog', status: 'invalid', detail: `Kein Katalog-Eintrag: ${input}`, bundle }
    }

    const indexRaw = catalogue.index
    if (!indexRaw) {
        return { intent: 'catalog', status: 'error', detail: 'Der Katalog ist gerade nicht lesbar - sein Inhaltsverzeichnis fehlt. Bitte dem Betrieb melden.' }
    }
    const edit = applyCatalogEntry(indexRaw, buildCatalogEntry(input))
    if (edit.status === 'withdrawn') {
        return {
            intent: 'catalog',
            status: 'invalid',
            detail: `Dieser Eintrag wurde aus dem Katalog zurückgezogen${edit.reason ? `: ${edit.reason}` : ''}. Ein erneutes Teilen macht ihn nicht wieder sichtbar - bitte beim Katalog-Team nachfragen.`,
            bundle,
        }
    }
    if (edit.status === 'conflict') {
        return {
            intent: 'catalog',
            status: 'invalid',
            detail: 'Im Katalog ist diese Adresse schon belegt: ein anderer Eintrag führt zur selben Katalogseite. Bitte mit einem anderen Kurznamen eine neue Version teilen.',
            bundle,
        }
    }
    if (edit.status === 'unchanged') {
        return { intent: 'catalog', status: 'unchanged', detail: 'Diese Version steht schon im Katalog.', bundle }
    }
    const proposing = openMergeRequest(catalogClient, {
        upstream: catalogProject,
        baseBranch: config.catalog.baseBranch,
        branch: catalogBranch(slug, version),
        title: `${edit.status === 'replaced' ? 'Update' : 'Add'} use case: ${input.displayName} ${version}`,
        description: [
            `Proposed by the Open Urban Apps marketplace on behalf of **${requestedBy}**.`,
            '',
            `${edit.status === 'replaced' ? `Replaces version ${edit.previousVersion ?? '?'} of` : 'Adds'} \`${input.id}\` in \`useCases\`, pinned to`,
            `\`${bundle.sha}\` of ${target.url} (path \`${dir}\`).`,
            '',
            `The entry is built from the merged \`core-ir/manifest.json\`. The package directory at the pin has the same tree id as in ${bundle.verification.mergedMrUrl ?? 'the merged export'}, so it is the reviewed package, file for file.` +
                (bundle.verification.changedInReview ? ' The review changed the package before the merge.' : ''),
            '',
            `Index version bumped to ${edit.indexVersion}.`,
            '',
            'Check: `python3 ci/validate-index.py`',
            '',
            // The dataset the accepted package's proposal names, so the entry belongs to that share.
            shareSourceLine({ kind: 'dataset', id: shareSourceOf(merged?.description)?.id ?? datasetId, instance: thisInstance() }),
        ].join('\n'),
        files: { 'index.json': edit.content },
        existingPaths: new Set(['index.json']),
    })
    let outcome: Awaited<typeof proposing>
    try {
        outcome = await proposing
    } catch (error) {
        // The catalogue branch names no publisher, so another package of that name and version may hold it.
        // This package's own "no" was refused above; one that came in since surfaces as GitLab's error.
        const own = error instanceof HeldBranchError && (!error.held.description || error.held.description.includes(`\`${packageId}\``))
        if (!(error instanceof HeldBranchError) || own) throw error
        return { intent: 'catalog', status: 'invalid', detail: heldEntryRefusal(slug, version, error.held.iid), mrUrl: error.held.web_url, bundle, catalog }
    }
    if (outcome.status === 'already-open') {
        return { intent: 'catalog', status: 'already-open', detail: `Für diese Version ist schon ein Katalog-Eintrag in Prüfung (Vorschlag !${outcome.iid}).`, mrUrl: outcome.url, bundle }
    }
    return {
        intent: 'catalog',
        status: 'ok',
        detail: `Katalog-Eintrag vorgeschlagen (Vorschlag !${outcome.iid}). Sobald das Katalog-Team ihn annimmt, steht der Anwendungsfall im Katalog und lässt sich installieren.`,
        mrUrl: outcome.url,
        bundle,
    }
}

function heldEntryRefusal(slug: string, version: string, iid: number): string {
    return `Kein Katalog-Eintrag: Für „${slug}“ in Version ${version} gibt es schon einen geschlossenen Vorschlag eines anderen Pakets (Vorschlag !${iid}). Er bleibt, wie er ist, damit das Katalog-Team ihn wieder öffnen kann - für dein Paket teile eine neue Version.`
}

function verificationRefusal(verification: BundleVerification | undefined): string {
    switch (verification?.state) {
        case 'changed-after-merge':
            return 'Kein Katalog-Eintrag: Das Paket im Ablageort weicht vom angenommenen Vorschlag ab, jemand hat es danach geändert. Bitte die Änderung ansehen und eine neue Version teilen, die wieder geprüft wird.'
        case 'unverifiable':
            return 'Kein Katalog-Eintrag: Der angenommene Vorschlag ist in GitLab nicht mehr lesbar, der Inhalt lässt sich nicht prüfen.'
        default:
            return 'Kein Katalog-Eintrag: Für dieses Paket gibt es keinen angenommenen Vorschlag dieses Marktplatzes, gegen den sich der Inhalt im Ablageort prüfen ließe.'
    }
}

/** From the shared packages list; arguments are checked again, as a server action answers any caller. */
export async function proposeSharedCatalogEntry(
    targetKey: string,
    slug: string,
    version: string,
): Promise<ExportActionResult> {
    const session = await requireSession()
    const requestedBy = proposerName(session.user)
    const refusal = shareRefusal(await fetchShareRight())
    if (refusal) return { intent: 'catalog', status: 'forbidden', detail: refusal }
    const config = exportConfig()
    const target = config.targets.find((candidate) => candidate.key === targetKey)
    if (exportReadiness(config) !== 'ready' || !target) {
        return { intent: 'catalog', status: 'unconfigured', detail: SHARING_NOT_SET_UP }
    }
    if (!SLUG.test(slug) || !VERSION.test(version)) {
        return { intent: 'catalog', status: 'invalid', detail: 'Ungültiger Kurzname oder ungültige Version.' }
    }
    try {
        return await proposeCatalog(config, target, config.token as string, slug, version, undefined, requestedBy)
    } catch (error) {
        if (error instanceof GitLabError) return { intent: 'catalog', status: 'error', detail: gitlabMessage(error) }
        throw error
    }
}

/** Arguments are checked again: a server action answers any caller. */
function deletionTarget(targetKey: string, slug: string, version: string): { config: ExportConfig; target: ExportTarget; token: string } | DeletionResult {
    const config = exportConfig()
    const target = config.targets.find((candidate) => candidate.key === targetKey)
    if (exportReadiness(config) !== 'ready' || !target) {
        return { status: 'unconfigured', detail: SHARING_NOT_SET_UP }
    }
    if (!SLUG.test(slug) || !VERSION.test(version)) return { status: 'invalid', detail: 'Ungültiger Kurzname oder ungültige Version.' }
    return { config, target, token: config.token as string }
}

/** What „Zurückziehen“ would do now, for the dialog to show first; reads only. */
export async function planShareDeletion(
    targetKey: string,
    slug: string,
    version: string,
): Promise<{ plan?: DeletionPlan; alternative?: DeletionPlan; error?: string }> {
    const session = await requireSession()
    const resolved = deletionTarget(targetKey, slug, version)
    if ('status' in resolved) return { error: resolved.detail }
    try {
        const { plan, alternative } = await readDeletion(resolved.config, resolved.target, resolved.token, slug, version, proposerName(session.user))
        return { plan, ...(alternative ? { alternative } : {}) }
    } catch (error) {
        if (error instanceof GitLabError) return { error: gitlabMessage(error) }
        throw error
    }
}

/** Runs only while GitLab still reads as the confirmed plan (`fingerprint`); else the new plan comes back. */
export async function deleteShare(
    targetKey: string,
    slug: string,
    version: string,
    fingerprint: string,
    scope: DeletionScope = 'proposal',
): Promise<DeletionResult> {
    const session = await requireSession()
    const refusal = shareRefusal(await fetchShareRight())
    if (refusal) return { status: 'forbidden', detail: refusal }
    if (!DELETION_SCOPES.includes(scope)) return { status: 'invalid', detail: 'Ungültige Auswahl.' }
    const resolved = deletionTarget(targetKey, slug, version)
    if ('status' in resolved) return resolved
    try {
        const requestedBy = proposerName(session.user)
        const { plan, work, alternative } = await readDeletion(resolved.config, resolved.target, resolved.token, slug, version, requestedBy, scope)
        if (plan.fingerprint !== fingerprint) {
            return {
                status: 'changed',
                detail: 'Bei GitLab hat sich der Stand gerade geändert. Bitte noch einmal ansehen, was Zurückziehen jetzt bedeutet.',
                plan,
                ...(alternative ? { alternative } : {}),
            }
        }
        return await runDeletion(plan, work, requestedBy, gitlabMessage)
    } catch (error) {
        if (error instanceof GitLabError) return { status: 'error', detail: gitlabMessage(error) }
        throw error
    }
}

const CATALOG_NOT_SET_UP = 'Der Katalog ist auf dieser Instanz noch nicht eingerichtet - das richtet der Betrieb ein.'

function hasDecline(bundle: BundleStatus, catalog: CatalogStatus): boolean {
    return Boolean(bundle.declined || catalog.state === 'declined' || removalDeclineShown(bundle, catalog))
}

function statusLine(bundle: BundleStatus, catalog: CatalogStatus): string {
    const removal = removalDeclineShown(bundle, catalog)
    const first =
        bundle.state === 'mr-open'
            ? 'Paket in Prüfung.'
            : bundle.state === 'on-base'
              ? removal
                  ? `Paket angenommen. Entfernen nicht angenommen (Vorschlag !${removal.iid}).`
                  : 'Paket angenommen.'
              : bundle.declined
                ? `Paket nicht angenommen (Vorschlag !${bundle.declined.iid}).`
                : sentenceOf(bundle.detail ?? 'Noch kein Paket im Ablageort.')
    const second =
        catalog.state === 'listed'
            ? 'Im Katalog.'
            : catalog.state === 'mr-open'
              ? 'Katalog-Eintrag in Prüfung.'
              : catalog.state === 'unconfigured'
                ? 'Katalog nicht eingerichtet.'
                : catalog.state === 'withdrawn'
                  ? 'Aus dem Katalog genommen.'
                  : catalog.state === 'declined'
                    ? 'Katalog-Eintrag nicht angenommen.'
                    : 'Noch nicht im Katalog.'
    return `${first} ${second}`
}

/** Status details end without a full stop, for use inside other sentences. */
function sentenceOf(text: string): string {
    return /[.!?]$/.test(text) ? text : `${text}.`
}

/** `type` for the code, `kind` as the page shows it. */
export interface InventoryArtifact {
    type: 'structure' | 'source' | 'mapping' | 'sink' | 'pipeline' | 'api' | 'style' | 'layer'
    kind: string
    name: string
    group?: 'map'
    depth?: 1 | 2
    detail?: string
    standard?: string
    /** `name` was made up or is the portal's default. */
    unnamed?: boolean
}

const PORTAL_DEFAULT_PIPELINE_NAMES: ReadonlySet<string> = new Set(['Untitled Pipeline', 'Pipeline ohne Namen'])

function mapArtifacts(snapshot: InstanceSnapshot): InventoryArtifact[] {
    const sinkNames = new Map(snapshot.sinks.map((sink) => [sink.id, sink.name]))
    const styles = new Map((snapshot.styles ?? []).map((style) => [style.id, style]))
    const used = new Set<string>()
    const rows: InventoryArtifact[] = (snapshot.apis ?? []).map((api): InventoryArtifact => ({
        type: 'api',
        kind: `API (${api.standard})`,
        name: api.name,
        group: 'map',
        standard: api.standard,
    }))
    for (const layer of snapshot.layers ?? []) {
        const sink = layer.dataSinkId ? sinkNames.get(layer.dataSinkId) : undefined
        rows.push({
            type: 'layer',
            kind: 'Kartenebene',
            name: layer.title ?? layer.layerName,
            group: 'map',
            depth: 1,
            detail: sink ? `zeigt Senke ${sink}` : 'ihre Senke gehört nicht zum Datensatz, die Ebene wird nicht geteilt',
        })
        for (const id of [layer.defaultStyleId, ...layer.alternativeStyleIds]) {
            const style = id ? styles.get(id) : undefined
            if (!style) continue
            used.add(style.id)
            rows.push({
                type: 'style',
                kind: 'Stil',
                name: style.name,
                group: 'map',
                depth: 2,
                ...(id === layer.defaultStyleId ? {} : { detail: 'alternativ' }),
            })
        }
    }
    for (const style of snapshot.styles ?? []) {
        if (!used.has(style.id)) {
            rows.push({ type: 'style', kind: 'Stil', name: style.name, group: 'map', depth: 1, detail: 'von keiner Ebene benutzt' })
        }
    }
    return rows
}

export interface DemoInventory {
    sources: DemoSource[]
    problem?: string
    simulatorUi?: string
}

export async function inspectExportSource(datasetId: string): Promise<{
    artifacts: InventoryArtifact[]; warnings: string[]; error?: string; demo?: DemoInventory
}> {
    await requireSession()
    if (!datasetId) return { artifacts: [], warnings: [], error: 'Ungültige Auswahl.' }
    try {
        const snapshot = await readUseCase(await getAccessToken(), datasetId)
        return {
            artifacts: [
                ...snapshot.structures.map((row) => ({ type: 'structure' as const, kind: 'Datenstruktur', name: row.name })),
                ...snapshot.sources.map((row) => ({ type: 'source' as const, kind: 'Datenquelle', name: row.name })),
                // Named as the package names them: by title, never by the instance's URN.
                ...snapshot.mappings.map((row, index) => ({
                    type: 'mapping' as const, kind: 'Mapping', name: mappingTitle(row, index), ...(isUnnamedMapping(row) ? { unnamed: true } : {}),
                })),
                ...snapshot.sinks.map((row) => ({ type: 'sink' as const, kind: 'Datensenke', name: row.name, ...(row.unnamed ? { unnamed: true } : {}) })),
                ...snapshot.pipelines.map((row) => ({
                    type: 'pipeline' as const, kind: 'Pipeline', name: row.name,
                    ...(row.unnamed || PORTAL_DEFAULT_PIPELINE_NAMES.has(row.name) ? { unnamed: true } : {}),
                })),
                ...mapArtifacts(snapshot),
            ],
            warnings: snapshot.warnings,
            demo: await demoInventory(snapshot),
        }
    } catch (error) {
        if (error instanceof PortalReadError) return { artifacts: [], warnings: [], error: error.message }
        throw error
    }
}

async function demoInventory(snapshot: Awaited<ReturnType<typeof readUseCase>>): Promise<DemoInventory> {
    const { details, problem } = await readSimulations()
    const ui = simulatorUiUrl()
    // The portal link is built here: only the server knows the portal's address.
    const sources = demoSources(snapshot, details).map((source) => (source.problem ? { ...source, portalHref: datasourceHref(source.id) } : source))
    return { sources, ...(problem ? { problem } : {}), ...(ui ? { simulatorUi: ui } : {}) }
}
