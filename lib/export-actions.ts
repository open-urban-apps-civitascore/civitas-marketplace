'use server'

import { useCaseSlugPattern } from '@/lib/catalog/schema'
import { applyCatalogEntry, buildCatalogEntry, catalogInputFromManifest } from '@/lib/export/catalog-entry'
import {
    bundleBranch,
    catalogBranch,
    exportConfig,
    exportReadiness,
    packageDir,
    parseBundleBranch,
    type CatalogRepo,
    type ExportConfig,
    type ExportTarget,
} from '@/lib/export/config'
import {
    clientFor,
    currentUser,
    getProject,
    GitLabError,
    listMergeRequestsBy,
    listOpenMergeRequests,
    listTree,
    openMergeRequest,
    parseProjectUrl,
    readFile,
    type GitLabClient,
    type GitLabProject,
    type MergeRequestRef,
} from '@/lib/export/gitlab'
import { SHARE_READS } from '@/lib/export/share-cache'
import { mapWithLimit } from '@/lib/concurrency'
import { parseExportMetadata } from '@/lib/export/metadata'
import { getCatalogSummaries } from '@/lib/catalog/source'
import { catalogEntryPath, matchesEntryPath } from '@/lib/use-case-catalog/path'
import { checkPackage } from '@/lib/export/package-check'
import { PortalReadError, readUseCase, type InstanceSnapshot } from '@/lib/export/portal-reader'
import {
    catalogStatusIn,
    inspectBundle,
    inspectBundleIn,
    packageFolder,
    readBaseTrees,
    readBundleStatus,
    readCatalogStatus,
    type BundleStatus,
    type BundleVerification,
    type CatalogContext,
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
    /** Rules of the package validator the export would fail — a merge request is refused while any exist. */
    errors: string[]
    /** Demo data in the package: scenarios (one per source) and the streams they run. */
    demo: { scenarios: number; streams: number }
}

export interface ExportActionResult {
    intent: ExportIntent
    status: 'ok' | 'error' | 'invalid' | 'unconfigured' | 'forbidden' | 'already-open' | 'not-merged' | 'unchanged'
    detail: string
    preview?: PreviewSummary
    mrUrl?: string
    bundle?: BundleStatus
    catalog?: CatalogStatus
}

interface ExportForm {
    intent: ExportIntent
    datasetId: string
    targetKey: string
    /** Simulator ids chosen as demo data; checked again against the dataset on the server. */
    demoStreams: string[]
    options: Omit<ExportOptions, 'provenance' | 'simulations'>
}

const SLUG = useCaseSlugPattern
const SEGMENT = /^[a-z0-9]{2,40}$/
const VERSION = /^\d+\.\d+\.\d+$/

function field(formData: FormData, name: string): string {
    const value = formData.get(name)
    return typeof value === 'string' ? value.trim() : ''
}

/** Validates the form into typed input, or names the first field that is wrong. */
function parseForm(formData: FormData): ExportForm | string {
    const intentRaw = field(formData, 'intent')
    const intent: ExportIntent =
        intentRaw === 'bundle' || intentRaw === 'catalog' || intentRaw === 'status' ? intentRaw : 'preview'
    const datasetId = field(formData, 'datasetId')
    if (!datasetId) return 'Bitte ein Dataset auswählen.'
    const targetKey = field(formData, 'targetKey')
    const publisher = field(formData, 'publisher').toLowerCase()
    if (!SEGMENT.test(publisher)) return 'Publisher: 2-40 Kleinbuchstaben oder Ziffern (er wird URN-Owner).'
    const slug = field(formData, 'slug').toLowerCase()
    if (!SLUG.test(slug)) return 'Paket-Slug: Kleinbuchstaben, Ziffern und Bindestriche, 2-60 Zeichen, Anfang und Ende alphanumerisch.'
    const version = field(formData, 'version') || '1.0.0'
    if (!VERSION.test(version)) return 'Version muss SemVer sein (z. B. 1.0.0).'
    const domain = field(formData, 'domain').toLowerCase() || 'general'
    if (!SEGMENT.test(domain)) return 'Domain: 2-40 Kleinbuchstaben oder Ziffern (URN-Segment).'
    const displayName = field(formData, 'displayName')
    if (!displayName) return 'Anzeigename fehlt.'
    const description = field(formData, 'description')
    if (!description) return 'Beschreibung fehlt.'
    const maintainer = field(formData, 'maintainer')
    if (!maintainer) return 'Maintainer fehlt.'
    const license = field(formData, 'license') || 'EUPL-1.2'
    const keywords = field(formData, 'keywords')
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean)
    const metadata = parseExportMetadata(field(formData, 'catalogMetadata'))
    if (metadata.error) return metadata.error
    const demoStreams = parseDemoStreams(field(formData, 'demoStreams'))
    if (!demoStreams) return 'Demo-Daten: ungültige Auswahl.'
    return {
        intent,
        datasetId,
        targetKey,
        demoStreams,
        options: { publisher, slug, version, domain, displayName, description, maintainer, license, keywords, metadata: metadata.data },
    }
}

/** A JSON list of simulator ids, or undefined when it is not one. Empty input means no demo data. */
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

/**
 * Every simulation of the simulator with the configuration it was built from.
 * The list carries no scenarios, so each is read once; the simulator caps its
 * registrations (50), which bounds the reads.
 */
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
            instance: process.env.PORTAL_URL,
            exportedBy,
            exportedAt: new Date().toISOString().slice(0, 10),
        },
    })
    // A chosen stream that could not be read is named, never silently dropped.
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
        `## ${preview.manifest.displayName} ${preview.manifest.version}`,
        '',
        preview.manifest.description,
        '',
        '## What this adds',
        '',
        `- \`${preview.packageDir}/\` (${preview.files.length} files) — a CORE-IR use-case package exported from a running instance`,
        `- id \`${preview.manifest.id}\`, license ${preview.manifest.license}, maintained by ${preview.manifest.maintainer}`,
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
    ].join('\n')
}

/**
 * One action, four intents, so a single form can preview, propose the bundle,
 * propose the catalogue entry and re-read the status without four copies of
 * the same field handling. The intent comes from the submit button's name.
 */
async function addressAlreadyTaken(id: string): Promise<string[]> {
    const { publisher, slug } = catalogEntryPath(id)
    try {
        const taken = (await getCatalogSummaries('usecase')).find(
            (row) => row.id !== id && matchesEntryPath(row.id, publisher, slug),
        )
        if (!taken) return []
        return [
            `Die Katalogseite /use-cases/${publisher}/${slug} ist bereits von \`${taken.id}\` belegt. ` +
                'Der Katalog-Eintrag würde später abgelehnt — bitte jetzt einen anderen Paket-Slug wählen.',
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
                    ? `Das Paket würde die Validierung nicht bestehen (${preview.errors.length} Fehler) — siehe unten.`
                    : `${preview.files.length} Dateien, ${preview.identities.length} Identitäten, ${preview.stripped.length} entfernte Geheimnisse.`,
                preview,
            }
        }

        // Everything below talks to GitLab; opening a merge request needs the right to share.
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
                        ? (config.targetsError ?? 'Kein Zielrepository konfiguriert (EXPORT_TARGET_REPOS).')
                        : readiness === 'missing-token'
                          ? 'Kein Zugang zu GitLab hinterlegt (EXPORT_REPO_TOKEN) — Vorschau funktioniert, Merge Requests nicht.'
                          : 'Bitte ein Zielrepository wählen.',
            }
        }
        const token = config.token as string
        const client = clientFor(target.url, token)

        if (form.intent === 'status') {
            const bundle = await readBundleStatus(client, target, form.options.slug, form.options.version, id)
            const catalog = await readCatalogStatus(
                config.catalog ? clientFor(config.catalog.url, token) : client,
                config.catalog,
                form.options.slug,
                form.options.version,
                id,
            )
            return { intent: 'status', status: 'ok', detail: statusLine(bundle, catalog), bundle, catalog }
        }

        if (form.intent === 'bundle') {
            // A version that is already proposed or merged is not proposed again: a second merge
            // request would carry the same version with other content, or the same content twice.
            // Asked before the package is built, which is the expensive part.
            const current = await readBundleStatus(client, target, form.options.slug, form.options.version, id)
            if (current.state === 'on-base') {
                return {
                    intent: 'bundle',
                    status: 'unchanged',
                    detail: `Version ${form.options.version} ist schon im Repository - Änderungen gehen jetzt nur noch mit einer neuen Version.`,
                    bundle: current,
                }
            }
            if (current.state === 'mr-open') {
                return {
                    intent: 'bundle',
                    status: 'already-open',
                    detail: `Für Version ${form.options.version} ist schon ein Merge Request offen.`,
                    mrUrl: current.mrUrl,
                    bundle: current,
                }
            }
            const accessToken = await getAccessToken()
            const pkg = await buildPackage(accessToken, form, requestedBy)
            const preview = summarise(pkg, target, form)
            if (preview.errors.length) {
                return {
                    intent: 'bundle',
                    status: 'invalid',
                    detail: `Kein Merge Request: das Paket würde die Validierung nicht bestehen (${preview.errors.length} Fehler).`,
                    preview,
                }
            }
            const project = await getProject(client, parseProjectUrl(target.url).projectPath)
            const dir = packageDir(target, form.options.slug)
            const existing = new Set(await listTree(client, project.id, dir, target.baseBranch))
            const files = Object.fromEntries(
                Object.entries(pkg.files).map(([path, content]) => [`${dir}/${path}`, content]),
            )
            const outcome = await openMergeRequest(client, {
                upstream: project,
                baseBranch: target.baseBranch,
                branch: preview.branch,
                title: `Export use case: ${form.options.displayName} ${form.options.version}`,
                description: mergeRequestBody(preview, form, requestedBy, Boolean(config.catalog)),
                files,
                existingPaths: existing,
            })
            if (outcome.status === 'already-open') {
                return {
                    intent: 'bundle',
                    status: 'already-open',
                    detail: `Es liegt bereits ein offener Merge Request (!${outcome.iid}) für ${form.options.slug} ${form.options.version} vor.`,
                    mrUrl: outcome.url,
                    preview,
                }
            }
            return {
                intent: 'bundle',
                status: 'ok',
                detail: `Merge Request !${outcome.iid} erstellt — nach dem Merge lässt sich der Katalog-Eintrag vorschlagen.`,
                mrUrl: outcome.url,
                preview,
            }
        }

        // intent === 'catalog'
        return await proposeCatalog(config, target, token, form.options.slug, form.options.version, id, requestedBy)
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

/**
 * Proposes the catalogue entry for a package on the target's base branch, for
 * the export form and the list of shared packages alike.
 *
 * Built from the MERGED manifest, not from a form: the entry then lists what
 * the bundle review saw, and the step still works days after the export.
 * Refused unless the package directory on the base branch is, by tree id, the
 * one the export's merge request brought.
 */
async function proposeCatalog(
    config: ExportConfig,
    target: ExportTarget,
    token: string,
    slug: string,
    version: string,
    expectedId: string | undefined,
    requestedBy: string,
): Promise<ExportActionResult> {
    if (!config.catalog) {
        return {
            intent: 'catalog',
            status: 'unconfigured',
            detail: 'Kein Katalog-Repository bekannt (REPO_LIST_URL oder CATALOG_REPO_URL).',
        }
    }
    const { status: bundle, manifestRaw } = await inspectBundle(
        clientFor(target.url, token),
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
                    ? 'Der Bundle-Merge-Request ist noch offen. Der Katalog-Eintrag kann erst auf den gemergten Stand zeigen.'
                    : (bundle.detail ?? `Auf ${target.baseBranch} liegt noch kein Paket ${slug} ${version}.`),
            bundle,
        }
    }
    if (bundle.verification?.state !== 'verified') {
        return {
            intent: 'catalog',
            status: 'invalid',
            detail: verificationRefusal(bundle.verification, target.baseBranch),
            bundle,
        }
    }

    const dir = packageDir(target, slug)
    const input = catalogInputFromManifest(manifestRaw, { repoUrl: target.url, path: dir, commitSha: bundle.sha })
    if (typeof input === 'string') {
        return { intent: 'catalog', status: 'invalid', detail: `Kein Katalog-Eintrag: ${input}`, bundle }
    }

    const catalogClient = clientFor(config.catalog.url, token)
    const catalogProject = await getProject(catalogClient, parseProjectUrl(config.catalog.url).projectPath)
    const indexRaw = await readFile(catalogClient, catalogProject.id, 'index.json', config.catalog.baseBranch)
    if (!indexRaw) {
        return { intent: 'catalog', status: 'error', detail: `index.json fehlt auf ${config.catalog.baseBranch} in ${config.catalog.url}.` }
    }
    const edit = applyCatalogEntry(indexRaw, buildCatalogEntry(input))
    if (edit.status === 'withdrawn') {
        return {
            intent: 'catalog',
            status: 'invalid',
            detail: `Dieser Eintrag wurde aus dem Katalog zurückgezogen${edit.reason ? `: ${edit.reason}` : ''}. Ein erneutes Teilen macht ihn nicht wieder sichtbar, bitte die Katalog-Pflege ansprechen.`,
            bundle,
        }
    }
    if (edit.status === 'conflict') {
        return {
            intent: 'catalog',
            status: 'invalid',
            detail: `Die Adresse dieses Anwendungsfalls ist schon belegt: \`${edit.conflictingId}\` führt zur selben Katalogseite. Bitte mit einem anderen Paket-Slug neu teilen.`,
            bundle,
        }
    }
    if (edit.status === 'unchanged') {
        return { intent: 'catalog', status: 'unchanged', detail: 'Der Katalog listet dieses Paket bereits in dieser Version an diesem Commit.', bundle }
    }
    const outcome = await openMergeRequest(catalogClient, {
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
        ].join('\n'),
        files: { 'index.json': edit.content },
        existingPaths: new Set(['index.json']),
    })
    if (outcome.status === 'already-open') {
        return { intent: 'catalog', status: 'already-open', detail: `Es liegt bereits ein offener Katalog-Merge-Request (!${outcome.iid}) vor.`, mrUrl: outcome.url, bundle }
    }
    return {
        intent: 'catalog',
        status: 'ok',
        detail: `Katalog-Merge-Request !${outcome.iid} erstellt. Nach dem Merge ist das Paket installierbar.`,
        mrUrl: outcome.url,
        bundle,
    }
}

function verificationRefusal(verification: BundleVerification | undefined, baseBranch: string): string {
    switch (verification?.state) {
        case 'changed-after-merge':
            return `Kein Katalog-Eintrag: Das Paket auf ${baseBranch} weicht vom gemergten Merge Request ab, jemand hat es danach geändert. Bitte die Änderung prüfen oder neu teilen.`
        case 'unverifiable':
            return 'Kein Katalog-Eintrag: Der Stand des gemergten Merge Requests ist in GitLab nicht mehr lesbar, der Inhalt lässt sich nicht prüfen.'
        default:
            return `Kein Katalog-Eintrag: Für dieses Paket gibt es keinen gemergten Export-Merge-Request, gegen den sich der Inhalt auf ${baseBranch} prüfen ließe.`
    }
}

/** One shared package version in one target repository. */
export interface SharedPackageRow {
    /** `<target url>#<branch>`. */
    key: string
    targetKey: string
    targetLabel: string
    slug: string
    version: string
    displayName: string
    bundleMr: { url: string; state: string }
    /** Read for a merged bundle only. */
    bundle?: BundleStatus
    catalog?: CatalogStatus
    /** Why the state could not be read completely; the row then shows its merge request only. */
    problem?: string
}

/**
 * The list stops at the newest: it is a look at what happened lately, not an
 * archive. A merged row costs two to four GitLab requests, since what all rows
 * share is read once per visit.
 */
const MAX_SHARED_ROWS = 15

/** How many packages are checked at once: side by side, but not every request at the same moment. */
const ROW_CONCURRENCY = 5

type ProjectOf = (client: GitLabClient, url: string) => Promise<GitLabProject>

/**
 * What this marketplace's bot has proposed, newest first, and where each
 * stands. Read from GitLab every time, like the status: the bot's merge
 * requests on `export/…` branches are the record, no marketplace bookkeeping.
 * A merged bundle is checked and gets its catalogue state, so the list can
 * offer the catalogue step without the form.
 *
 * Asked the way that keeps the page quick (it took about half a minute with
 * nine merged packages, Ewa 2026-10-14): what every row shares - the
 * project, the base branch with its package folders, the catalogue's open
 * merge requests and index - is read once per visit; the rows are then
 * checked side by side; and what a commit or a merged request holds is kept
 * in memory (`SHARE_READS`), because it cannot change.
 */
export async function listSharedPackages(): Promise<{ rows: SharedPackageRow[]; error?: string }> {
    await requireSession()
    const config = exportConfig()
    if (exportReadiness(config) !== 'ready') return { rows: [] }
    const token = config.token as string

    // One lookup per project and visit: target and catalogue are often the same repository.
    const projects = new Map<string, Promise<GitLabProject>>()
    const projectOf: ProjectOf = (client, url) => {
        const key = `${client.apiBase}|${parseProjectUrl(url).projectPath}`
        let project = projects.get(key)
        if (!project) {
            project = getProject(client, parseProjectUrl(url).projectPath)
            projects.set(key, project)
        }
        return project
    }

    // Started at once, awaited by the rows that need it; a failure there is reported per row.
    const catalog = readCatalogContext(config.catalog, token, projectOf)
    catalog.catch(() => {})

    try {
        const rows: SharedPackageRow[] = []
        for (const target of config.targets) rows.push(...(await sharedRowsOf(target, token, projectOf, catalog)))
        return { rows }
    } catch (error) {
        if (error instanceof GitLabError) return { rows: [], error: gitlabMessage(error) }
        throw error
    }
}

/**
 * One target's shared packages. The bot's merge requests and the base branch
 * with its package folders are asked once, side by side; then the rows.
 */
async function sharedRowsOf(
    target: ExportTarget,
    token: string,
    projectOf: ProjectOf,
    catalog: Promise<CatalogContext | undefined>,
): Promise<SharedPackageRow[]> {
    const client: GitLabClient = { ...clientFor(target.url, token), cache: SHARE_READS }
    const [project, bot] = await Promise.all([projectOf(client, target.url), currentUser(client)])
    const base = readBaseTrees(client, project.id, target)
    base.catch(() => {})
    const requests = await listMergeRequestsBy(client, project.id, bot.id)

    // Newest first, so a branch's first request is the one that counts. The bot
    // names the export branches, so its own requests are all there are from
    // them: asking GitLab once more per branch would add nothing.
    const byBranch = new Map<string, MergeRequestRef[]>()
    for (const mr of requests) {
        if (!parseBundleBranch(mr.source_branch)) continue
        const known = byBranch.get(mr.source_branch)
        if (known) known.push(mr)
        else if (byBranch.size < MAX_SHARED_ROWS) byBranch.set(mr.source_branch, [mr])
    }
    return mapWithLimit([...byBranch.values()], ROW_CONCURRENCY, (branchRequests) =>
        sharedPackageRow(target, client, project.id, base, branchRequests, catalog),
    )
}

async function sharedPackageRow(
    target: ExportTarget,
    client: GitLabClient,
    projectId: number,
    base: Promise<{ head: string | undefined; trees: Map<string, string> }>,
    requests: MergeRequestRef[],
    catalog: Promise<CatalogContext | undefined>,
): Promise<SharedPackageRow> {
    const mr = requests[0]
    const parsed = parseBundleBranch(mr.source_branch) as { slug: string; version: string }
    const row: SharedPackageRow = {
        key: `${target.key}#${mr.source_branch}`,
        targetKey: target.key,
        targetLabel: target.label,
        slug: parsed.slug,
        version: parsed.version,
        displayName: displayNameOf(mr.title, parsed.version) ?? parsed.slug,
        bundleMr: { url: mr.web_url, state: mr.state },
    }
    if (mr.state !== 'merged') return row

    try {
        const { head, trees } = await base
        const { status: bundle } = await inspectBundleIn(client, target, parsed.slug, parsed.version, undefined, {
            projectId,
            requests,
            head,
            treeOnBase: async () => trees.get(packageFolder(target, parsed.slug).name),
        })
        if (!bundle.packageId) return { ...row, bundle }
        const context = await catalog
        return {
            ...row,
            bundle,
            catalog: context ? catalogStatusIn(context, parsed.slug, parsed.version, bundle.packageId) : { state: 'unconfigured' },
        }
    } catch (error) {
        // One package GitLab cannot answer for does not take the list down with it.
        if (error instanceof GitLabError) return { ...row, problem: gitlabMessage(error) }
        throw error
    }
}

/** The catalogue repository's open merge requests and its index, for every row of a listing at once. */
async function readCatalogContext(
    repo: CatalogRepo | undefined,
    token: string,
    projectOf: ProjectOf,
): Promise<CatalogContext | undefined> {
    if (!repo) return undefined
    const client: GitLabClient = { ...clientFor(repo.url, token), cache: SHARE_READS }
    const project = await projectOf(client, repo.url)
    const [openRequests, index] = await Promise.all([
        listOpenMergeRequests(client, project.id),
        readFile(client, project.id, 'index.json', repo.baseBranch),
    ])
    return { openRequests, index }
}

/** The display name inside the bundle request's title, as `exportAction` writes it. */
function displayNameOf(title: string | undefined, version: string): string | undefined {
    const match = title?.match(/^Export use case: (.+) (\d+\.\d+\.\d+)$/)
    return match && match[2] === version ? match[1] : undefined
}

/**
 * The catalogue step from the list of shared packages: no form, the merged
 * manifest is the source. Arguments are re-checked here, since a server
 * action answers any caller.
 */
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
        return { intent: 'catalog', status: 'unconfigured', detail: 'Zielrepository oder GitLab-Zugang ist nicht konfiguriert.' }
    }
    if (!SLUG.test(slug) || !VERSION.test(version)) {
        return { intent: 'catalog', status: 'invalid', detail: 'Ungültiger Paket-Slug oder ungültige Version.' }
    }
    try {
        return await proposeCatalog(config, target, config.token as string, slug, version, undefined, requestedBy)
    } catch (error) {
        if (error instanceof GitLabError) return { intent: 'catalog', status: 'error', detail: gitlabMessage(error) }
        throw error
    }
}

function statusLine(bundle: BundleStatus, catalog: CatalogStatus): string {
    const first =
        bundle.state === 'mr-open'
            ? 'Bundle-Merge-Request offen.'
            : bundle.state === 'on-base'
              ? 'Paket liegt auf dem Basisbranch.'
              : (bundle.detail ?? 'Noch kein Paket im Zielrepo.')
    const second =
        catalog.state === 'listed'
            ? 'Im Katalog gelistet.'
            : catalog.state === 'mr-open'
              ? 'Katalog-Merge-Request offen.'
              : catalog.state === 'unconfigured'
                ? 'Katalog-Repo nicht konfiguriert.'
                : 'Noch nicht im Katalog.'
    return `${first} ${second}`
}

function gitlabMessage(error: GitLabError): string {
    switch (error.status) {
        case 0:
            return error.message
        case 401:
            return 'GitLab lehnt den hinterlegten Token ab (401) — ungültig oder abgelaufen.'
        case 403:
            return `GitLab verweigert die Aktion (403): ${error.message}`
        case 404:
            return `GitLab: ${error.message} — bei privaten Projekten auch, wenn der Token dort keinen Zugriff hat.`
        default:
            return `GitLab-Fehler (${error.status}): ${error.message}`
    }
}

/** One row of the inventory: `type` for the code to decide on, `kind` as the page shows it. */
export interface InventoryArtifact {
    type: 'structure' | 'source' | 'mapping' | 'sink' | 'pipeline' | 'api' | 'style' | 'layer'
    kind: string
    name: string
    /** The map members are shown as one group, see mapArtifacts. */
    group?: 'map'
    /** Indent inside the group: a layer under the API, a style under its layer. */
    depth?: 1 | 2
    /** A grey line under the name, e.g. the sink a layer shows. */
    detail?: string
    /** An API's standard ("OWS"), for naming the map service as a whole. */
    standard?: string
    /** No name of its own: `name` was made up (or is the portal's default) and travels as such. */
    unnamed?: boolean
}

/** The portal's names for a pipeline nobody named, in each of its languages. */
const PORTAL_DEFAULT_PIPELINE_NAMES: ReadonlySet<string> = new Set(['Untitled Pipeline', 'Pipeline ohne Namen'])

/**
 * The map members as one group, the way a reader asks about them ("what belongs
 * to the map?"): the API first, each layer under it with the sink it shows, each
 * layer's styles under the layer. The platform keeps all three as objects of the
 * dataset; it is the layer that refers to a sink and to styles, and the API that
 * makes the dataset's layers reachable. A style no layer uses stands on its own.
 */
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
            detail: sink ? `zeigt Senke ${sink}` : 'ihre Senke gehört nicht zum Use Case, die Ebene wird nicht geteilt',
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

/** Demo data the share can take along: the streams per source, or why none could be read. */
export interface DemoInventory {
    sources: DemoSource[]
    problem?: string
    /** Base address of the simulator's own interface, where a stream can be made; absent when unknown. */
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
                // Named as the package will name them: a mapping by its title, never by the instance's URN.
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
