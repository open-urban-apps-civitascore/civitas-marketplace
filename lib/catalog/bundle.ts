import { assembleCatalogEntry, CatalogIntegrityError, parsePackageManifest } from '@/lib/catalog/assemble'
import type { CatalogEntry, CatalogSummary, DeploymentRef } from '@/lib/catalog/types'

/**
 * Fetches a package (manifest + member files) straight from its git artifact
 * repo — nothing is shipped with the app. Layout convention (see the artifact
 * repos under gitlab.com/civitascore-openurbanapps):
 *
 *   core-ir/manifest.json       — the package document (entry point):
 *                                 catalogue manifest + member file list
 *   core-ir/<slug>.<kind>.json  — one file per member, kind ∈ datastructure |
 *                                 datasource | mapping | datasink | pipeline
 *
 * The member list exists because raw URLs cannot list directories: the
 * manifest is the only way a package can say what it consists of.
 *
 * The catalogue row pins a commit SHA and everything is fetched AT that SHA,
 * so the installed content provably matches the pin. Nothing is ever
 * resolved: a ref that is not a commit refuses the install outright.
 */

export class BundleError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message)
        this.name = 'BundleError'
    }
}

const FETCH_TIMEOUT_MS = 5000

const COMMIT_SHA = /^[0-9a-f]{40}$/i
// Mirrors the parse boundary's allowlist (repo-list.ts) as defence in depth:
// a '..' segment would survive URL normalisation into a different ref.
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// GitLab-style raw file URL for a path at a pinned ref, mirroring how the
// repo-list itself is fetched (…/-/raw/<ref>/<path>).
function rawUrl(repoUrl: string, ref: string, path: string): string {
    return `${repoUrl.replace(/\/+$/, '')}/-/raw/${encodeURIComponent(ref)}/${path}`
}

async function fetchJson(url: string): Promise<unknown> {
    const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).catch((error) => {
        throw new BundleError(
            `Bundle fetch failed: ${error instanceof Error ? error.message : url}`,
            502,
        )
    })

    if (response.status === 404) {
        throw new BundleError(`Bundle file not found: ${url}`, 424)
    }
    if (!response.ok) {
        throw new BundleError(`Bundle fetch returned ${response.status} for ${url}`, 502)
    }
    return response.json().catch(() => {
        throw new BundleError(`Bundle file is not valid JSON: ${url}`, 502)
    })
}

export interface FetchedCatalogEntry {
    entry: CatalogEntry
    /** The commit SHA every file was fetched at — the enforced pin. */
    commit: string
}

/**
 * Fetches and assembles the package a catalogue row points at. Cross-checks
 * row against package manifest (id and version must match) so the listing
 * duplication in the index stays honest — a row that promises one package and
 * delivers another is refused, never installed.
 */
export async function fetchCatalogEntry(summary: CatalogSummary): Promise<FetchedCatalogEntry> {
    const pin: DeploymentRef | undefined = summary.deploymentRef
    if (!pin) {
        throw new BundleError(`Catalogue row ${summary.id} has no source to fetch from`, 500)
    }

    if (pin.path !== '.' && !pin.path.split('/').every((s) => SAFE_PATH_SEGMENT.test(s))) {
        throw new BundleError(`Catalogue row ${summary.id} carries an unsafe package path`, 502)
    }

    // The pin IS the commit — nothing is resolved. Defence in depth behind
    // the parser: fetching from a mutable ref would install unverifiable
    // content, which is exactly what the pin exists to prevent.
    if (!COMMIT_SHA.test(pin.ref)) {
        throw new BundleError(
            `Pin '${pin.ref}' of catalogue row ${summary.id} is not a commit SHA — ` +
                `refusing to install from a mutable ref`,
            502,
        )
    }
    const commit = pin.ref.toLowerCase()

    const dir = pin.path === '.' ? '' : `${pin.path.replace(/\/+$/, '')}/`

    const manifest = parsePackageManifest(
        await fetchJson(rawUrl(pin.url, commit, `${dir}core-ir/manifest.json`)),
        `${pin.url}@${pin.releaseTag ?? pin.ref}`,
    )
    if (manifest.id !== summary.id) {
        throw new BundleError(
            `Package id '${manifest.id}' does not match catalogue row '${summary.id}'`,
            502,
        )
    }
    if (manifest.version !== summary.version) {
        throw new BundleError(
            `Package version '${manifest.version}' does not match catalogue row '${summary.version}' for ${summary.id}`,
            502,
        )
    }

    // Fetch all member files concurrently, then assemble from the map — the
    // same assembly path the mock fixtures use.
    const files = [
        ...manifest.members.dataStructures,
        ...(manifest.members.dataSources ?? []),
        ...(manifest.members.mappings ?? []),
        ...(manifest.members.dataSinks ?? []),
        ...(manifest.members.pipelines ?? []),
        ...(manifest.members.simulations ?? []),
    ].map((member) => member.file)

    const contents = new Map<string, Record<string, unknown>>()
    await Promise.all(
        files.map(async (file) => {
            contents.set(
                file,
                (await fetchJson(rawUrl(pin.url, commit, `${dir}core-ir/${file}`))) as Record<
                    string,
                    unknown
                >,
            )
        }),
    )

    try {
        const entry = assembleCatalogEntry(manifest, (file) => {
            const content = contents.get(file)
            if (!content) throw new CatalogIntegrityError(`member file '${file}' was not fetched`)
            return content
        })
        return { entry, commit }
    } catch (error) {
        if (error instanceof CatalogIntegrityError) {
            throw new BundleError(error.message, 502)
        }
        throw error
    }
}
