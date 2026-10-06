import { isListed } from '@/lib/export/catalog-entry'
import { bundleBranch, catalogBranch, packageDir, type CatalogRepo, type ExportTarget } from '@/lib/export/config'
import {
    branchHead,
    findMergeRequests,
    getProject,
    mergeRequestCommits,
    parseProjectUrl,
    readFile,
    treeIdOf,
    type GitLabClient,
    type MergeRequestRef,
} from '@/lib/export/gitlab'

/**
 * Where an export stands, read fresh from GitLab every time — no marketplace
 * bookkeeping. The two steps (bundle merge request, catalogue entry) each
 * have a state, and the catalogue step is only offered once the bundle is on
 * the target's base branch: the pin may point at nothing but a commit that
 * exists there.
 *
 * A package on the base branch is also checked against the merge request
 * that brought it, by tree id (see `treeIdOf`): the catalogue must list what
 * the review saw, and comparing directory hashes makes that independent of
 * how the target repository merges.
 */

/**
 * - `verified`: the package directory on the base branch is the merged one, file for file
 * - `changed-after-merge`: something changed it after the merge
 * - `no-merge-request`: it arrived without a merged export, so there is nothing to compare with
 * - `unverifiable`: the merged state can no longer be read
 */
export interface BundleVerification {
    state: 'verified' | 'changed-after-merge' | 'no-merge-request' | 'unverifiable'
    /** The merged package differs from what the marketplace exported: the review changed it. A note, not a refusal. */
    changedInReview?: boolean
    mergedMrUrl?: string
}

export interface BundleStatus {
    state: 'none' | 'mr-open' | 'on-base'
    mrUrl?: string
    /** Base-branch head the package was verified at — the commit a catalogue entry pins. */
    sha?: string
    /** The package id its manifest on the base branch carries. */
    packageId?: string
    /** Set for a package on the base branch. */
    verification?: BundleVerification
    detail?: string
}

export interface CatalogStatus {
    state: 'unconfigured' | 'none' | 'mr-open' | 'listed'
    mrUrl?: string
}

/** Tree ids of the package directory in the three states that matter; undefined where unreadable. */
export interface BundleTrees {
    onBase?: string
    merged?: string
    exported?: string
}

/** The decision apart from the reads, so every outcome is testable without a forge. */
export function judgeBundle(merged: MergeRequestRef | undefined, trees: BundleTrees): BundleVerification {
    if (!merged) return { state: 'no-merge-request' }
    const mergedMrUrl = merged.web_url
    if (!trees.merged || !trees.onBase) return { state: 'unverifiable', mergedMrUrl }
    if (trees.onBase !== trees.merged) return { state: 'changed-after-merge', mergedMrUrl }
    return {
        state: 'verified',
        mergedMrUrl,
        changedInReview: Boolean(trees.exported && trees.exported !== trees.merged),
    }
}

async function readTrees(
    client: GitLabClient,
    projectId: number,
    dir: string,
    head: string,
    merged: MergeRequestRef | undefined,
): Promise<BundleTrees> {
    if (!merged?.sha) return {}
    const commits = await mergeRequestCommits(client, projectId, merged.iid).catch(() => [])
    // GitLab lists newest first, so the oldest is the commit the export made.
    const exportedSha = commits.at(-1)?.id
    const [onBase, mergedTree, exported] = await Promise.all([
        treeIdOf(client, projectId, dir, head),
        treeIdOf(client, projectId, dir, merged.sha),
        exportedSha && exportedSha !== merged.sha
            ? treeIdOf(client, projectId, dir, exportedSha)
            : Promise.resolve(undefined),
    ])
    // An unreadable export commit claims no change: the note must not cry wolf.
    return { onBase, merged: mergedTree, exported: exported ?? mergedTree }
}

/** What `readBundleStatus` reports, plus the manifest it read, for a catalogue entry built from it. */
export interface BundleInspection {
    status: BundleStatus
    manifestRaw?: string
}

/**
 * `expectedId` pins the package id when the caller knows it (the export
 * form). Without it, as for a listed share, any `urn:…:usecase:<slug>` of
 * that version counts.
 */
export async function inspectBundle(
    client: GitLabClient,
    target: ExportTarget,
    slug: string,
    version: string,
    expectedId?: string,
): Promise<BundleInspection> {
    const project = await getProject(client, parseProjectUrl(target.url).projectPath)
    const requests = await findMergeRequests(client, project.id, bundleBranch(slug, version))
    const open = requests.find((mr) => mr.state === 'opened')
    if (open) return { status: { state: 'mr-open', mrUrl: open.web_url } }

    const head = await branchHead(client, project.id, target.baseBranch)
    if (!head) return { status: { state: 'none', detail: `Branch ${target.baseBranch} existiert nicht in ${target.url}` } }
    const dir = packageDir(target, slug)
    const manifestRaw = await readFile(client, project.id, `${dir}/core-ir/manifest.json`, head)
    if (!manifestRaw) return { status: { state: 'none' } }

    let manifest: { id?: unknown; version?: unknown }
    try {
        manifest = JSON.parse(manifestRaw) as { id?: unknown; version?: unknown }
    } catch {
        return { status: { state: 'none', detail: 'manifest.json auf dem Basisbranch ist kein gültiges JSON' } }
    }
    const idMatches =
        expectedId !== undefined
            ? manifest.id === expectedId
            : typeof manifest.id === 'string' && manifest.id.endsWith(`:usecase:${slug}`)
    if (!idMatches || manifest.version !== version) {
        return {
            status: {
                state: 'none',
                detail: `Auf ${target.baseBranch} liegt ${String(manifest.id)} ${String(manifest.version)}, nicht ${expectedId ?? slug} ${version}`,
            },
        }
    }

    const merged = requests.find((mr) => mr.state === 'merged')
    const verification = judgeBundle(merged, await readTrees(client, project.id, dir, head, merged))
    return {
        status: { state: 'on-base', sha: head, packageId: String(manifest.id), verification },
        manifestRaw,
    }
}

export async function readBundleStatus(
    client: GitLabClient,
    target: ExportTarget,
    slug: string,
    version: string,
    expectedId?: string,
): Promise<BundleStatus> {
    return (await inspectBundle(client, target, slug, version, expectedId)).status
}

export async function readCatalogStatus(
    client: GitLabClient,
    catalog: CatalogRepo | undefined,
    slug: string,
    version: string,
    id: string,
): Promise<CatalogStatus> {
    if (!catalog) return { state: 'unconfigured' }
    const project = await getProject(client, parseProjectUrl(catalog.url).projectPath)
    const open = (await findMergeRequests(client, project.id, catalogBranch(slug, version))).find(
        (mr) => mr.state === 'opened',
    )
    if (open) return { state: 'mr-open', mrUrl: open.web_url }
    const index = await readFile(client, project.id, 'index.json', catalog.baseBranch)
    if (index && isListed(index, id, version)) return { state: 'listed' }
    return { state: 'none' }
}
