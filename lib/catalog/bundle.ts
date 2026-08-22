import { assembleCatalogEntry, CatalogIntegrityError, parsePackageManifest } from '@/lib/catalog/assemble'
import type { CatalogEntry, CatalogSummary, RepoSource } from '@/lib/catalog/types'

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
 * The catalogue row pins a git ref (tag/commit). The ref is resolved to an
 * immutable commit SHA first and everything is fetched AT that SHA, so the
 * installed content provably matches the pin (no race with a moving tag).
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

// GitLab-style raw file URL for a path at a pinned ref, mirroring how the
// repo-list itself is fetched (…/-/raw/<ref>/<path>).
function rawUrl(repoUrl: string, ref: string, path: string): string {
    return `${repoUrl.replace(/\/+$/, '')}/-/raw/${encodeURIComponent(ref)}/${path}`
}

/**
 * Resolve a git ref (tag/commit) to its full commit SHA via the GitLab commits
 * API (public, no token). Returns null on failure — the install still proceeds
 * from the ref, just without the immutable commit pin. GitLab-specific, like
 * `rawUrl`.
 */
async function resolveCommitSha(repoUrl: string, ref: string): Promise<string | null> {
    try {
        const url = new URL(repoUrl)
        const project = encodeURIComponent(url.pathname.replace(/^\/+|\/+$/g, ''))
        const api = `${url.origin}/api/v4/projects/${project}/repository/commits/${encodeURIComponent(ref)}`
        const response = await fetch(api, {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (!response.ok) return null
        const body = (await response.json()) as { id?: unknown }
        return typeof body.id === 'string' ? body.id : null
    } catch (error) {
        console.warn(`[bundle] could not resolve commit for ${repoUrl}@${ref}:`, error)
        return null
    }
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
    /** The commit SHA the pin resolved to (absent if resolution failed). */
    commit?: string
}

/**
 * Fetches and assembles the package a catalogue row points at. Cross-checks
 * row against package manifest (id and version must match) so the listing
 * duplication in the index stays honest — a row that promises one package and
 * delivers another is refused, never installed.
 */
export async function fetchCatalogEntry(summary: CatalogSummary): Promise<FetchedCatalogEntry> {
    const source: RepoSource | undefined = summary.source
    if (!source) {
        throw new BundleError(`Catalogue row ${summary.id} has no source to fetch from`, 500)
    }

    const commit = await resolveCommitSha(source.repoUrl, source.gitIdentifier)
    const ref = commit ?? source.gitIdentifier

    const manifest = parsePackageManifest(
        await fetchJson(rawUrl(source.repoUrl, ref, 'core-ir/manifest.json')),
        `${source.repoUrl}@${source.gitIdentifier}`,
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
                (await fetchJson(rawUrl(source.repoUrl, ref, `core-ir/${file}`))) as Record<
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
        return { entry, commit: commit ?? undefined }
    } catch (error) {
        if (error instanceof CatalogIntegrityError) {
            throw new BundleError(error.message, 502)
        }
        throw error
    }
}
