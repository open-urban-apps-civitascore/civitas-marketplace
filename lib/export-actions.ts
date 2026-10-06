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
    type ExportConfig,
    type ExportTarget,
} from '@/lib/export/config'
import {
    clientFor,
    currentUser,
    getProject,
    GitLabError,
    listMergeRequestsBy,
    listTree,
    openMergeRequest,
    parseProjectUrl,
    readFile,
    type GitLabClient,
    type MergeRequestRef,
} from '@/lib/export/gitlab'
import { parseExportMetadata } from '@/lib/export/metadata'
import { getCatalogSummaries } from '@/lib/catalog/source'
import { catalogEntryPath, matchesEntryPath } from '@/lib/use-case-catalog/path'
import { checkPackage } from '@/lib/export/package-check'
import { PortalReadError, readUseCase } from '@/lib/export/portal-reader'
import {
    inspectBundle,
    readBundleStatus,
    readCatalogStatus,
    type BundleStatus,
    type BundleVerification,
    type CatalogStatus,
} from '@/lib/export/status'
import { transformSnapshot, type ExportedPackage, type ExportOptions } from '@/lib/export/transform'
import { getAccessToken, requireSession } from '@/lib/session'

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
}

export interface ExportActionResult {
    intent: ExportIntent
    status: 'ok' | 'error' | 'invalid' | 'unconfigured' | 'already-open' | 'not-merged' | 'unchanged'
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
    options: Omit<ExportOptions, 'provenance'>
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
    return {
        intent,
        datasetId,
        targetKey,
        options: { publisher, slug, version, domain, displayName, description, maintainer, license, keywords, metadata: metadata.data },
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
    return transformSnapshot(snapshot, {
        ...form.options,
        provenance: {
            datasetId: snapshot.dataset.id,
            datasetName: snapshot.dataset.name,
            instance: process.env.PORTAL_URL,
            exportedBy,
            exportedAt: new Date().toISOString().slice(0, 10),
        },
    })
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
    const requestedBy = session.user?.name ?? session.user?.email ?? 'unbekannt'
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

        // Everything below talks to GitLab.
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
}

/** Each merged row costs about ten GitLab requests, so the list stops at the newest. */
const MAX_SHARED_ROWS = 15

/**
 * What this marketplace's bot has proposed, newest first, and where each
 * stands. Read from GitLab every time, like the status: the bot's merge
 * requests on `export/…` branches are the record, no marketplace bookkeeping.
 * A merged bundle is checked and gets its catalogue state, so the list can
 * offer the catalogue step without the form.
 */
export async function listSharedPackages(): Promise<{ rows: SharedPackageRow[]; error?: string }> {
    await requireSession()
    const config = exportConfig()
    if (exportReadiness(config) !== 'ready') return { rows: [] }
    const token = config.token as string

    try {
        const rows: SharedPackageRow[] = []
        for (const target of config.targets) {
            const client = clientFor(target.url, token)
            const project = await getProject(client, parseProjectUrl(target.url).projectPath)
            const bot = await currentUser(client)
            const seen = new Set<string>()
            for (const mr of await listMergeRequestsBy(client, project.id, bot.id)) {
                const parsed = parseBundleBranch(mr.source_branch)
                // Newest first: the first request per branch is the one that counts.
                if (!parsed || seen.has(mr.source_branch)) continue
                seen.add(mr.source_branch)
                rows.push(await sharedPackageRow(config, target, client, token, mr, parsed))
                if (seen.size >= MAX_SHARED_ROWS) break
            }
        }
        return { rows }
    } catch (error) {
        if (error instanceof GitLabError) return { rows: [], error: gitlabMessage(error) }
        throw error
    }
}

async function sharedPackageRow(
    config: ExportConfig,
    target: ExportTarget,
    client: GitLabClient,
    token: string,
    mr: MergeRequestRef,
    parsed: { slug: string; version: string },
): Promise<SharedPackageRow> {
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

    const bundle = await readBundleStatus(client, target, parsed.slug, parsed.version)
    if (!bundle.packageId) return { ...row, bundle }
    const catalog = await readCatalogStatus(
        config.catalog ? clientFor(config.catalog.url, token) : client,
        config.catalog,
        parsed.slug,
        parsed.version,
        bundle.packageId,
    )
    return { ...row, bundle, catalog }
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
    const requestedBy = session.user?.name ?? session.user?.email ?? 'unbekannt'
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

export async function inspectExportSource(datasetId: string): Promise<{
    artifacts: { kind: string; name: string }[]; warnings: string[]; error?: string
}> {
    await requireSession()
    if (!datasetId) return { artifacts: [], warnings: [], error: 'Ungültige Auswahl.' }
    try {
        const snapshot = await readUseCase(await getAccessToken(), datasetId)
        return {
            artifacts: [
                ...snapshot.structures.map((row) => ({ kind: 'Datenstruktur', name: row.name })),
                ...snapshot.sources.map((row) => ({ kind: 'Datenquelle', name: row.name })),
                ...snapshot.mappings.map((row) => ({ kind: 'Mapping', name: row.urn })),
                ...snapshot.sinks.map((row) => ({ kind: 'Datensenke', name: row.name })),
                ...snapshot.pipelines.map((row) => ({ kind: 'Pipeline', name: row.name })),
            ],
            warnings: snapshot.warnings,
        }
    } catch (error) {
        if (error instanceof PortalReadError) return { artifacts: [], warnings: [], error: error.message }
        throw error
    }
}
