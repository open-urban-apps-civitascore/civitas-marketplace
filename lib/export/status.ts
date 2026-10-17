import { isListed } from '@/lib/export/catalog-entry'
import { bundleBranch, catalogBranch, packageDir, removalBranch, type CatalogRepo, type ExportTarget } from '@/lib/export/config'
import {
    branchHead,
    directoryTrees,
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
    /**
     * Why the version is not on the base branch, for state `none`: there is no
     * such branch, no package, an unreadable manifest, or another version.
     * Absent for a version simply never proposed.
     */
    reason?: 'no-base-branch' | 'no-package' | 'bad-manifest' | 'other-version'
    /** What the base branch carries instead, for reason `other-version`. */
    onBase?: { id: string; version: string }
    /**
     * The newest proposal to take this version out of the repository again
     * ("Löschen" in "In Arbeit"), whatever became of it. Not read while the
     * version has an open merge request: a new proposal comes first.
     */
    removal?: { state: string; mrUrl: string }
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
    treeOnBase: () => Promise<string | undefined>,
    merged: MergeRequestRef | undefined,
): Promise<BundleTrees> {
    if (!merged?.sha) return {}
    // Only the exported tree waits for the commits; the other two are asked alongside.
    const [commits, onBase, mergedTree] = await Promise.all([
        mergeRequestCommits(client, projectId, merged.iid, true).catch(() => []),
        treeOnBase(),
        treeIdOf(client, projectId, dir, merged.sha),
    ])
    // GitLab lists newest first, so the oldest is the commit the export made.
    const exportedSha = commits.at(-1)?.id
    const exported =
        exportedSha && exportedSha !== merged.sha ? await treeIdOf(client, projectId, dir, exportedSha) : undefined
    // An unreadable export commit claims no change: the note must not cry wolf.
    return { onBase, merged: mergedTree, exported: exported ?? mergedTree }
}

/** What `readBundleStatus` reports, plus the manifest it read, for a catalogue entry built from it. */
export interface BundleInspection {
    status: BundleStatus
    manifestRaw?: string
}

/**
 * What checking one package needs that a listing reads once for all of its
 * packages: where they live, the merge requests from the package's branch,
 * the base branch head, and the package folder's tree id there.
 */
export interface BundleContext {
    projectId: number
    /** Merge requests from the package's branch, newest first, any state. */
    requests: MergeRequestRef[]
    /** The base branch head; undefined when the branch does not exist. */
    head: string | undefined
    /** The package folder's tree id at `head`. */
    treeOnBase: () => Promise<string | undefined>
    /** The newest merge request from the version's removal branch, if there is one. */
    removal?: MergeRequestRef
    /** Check the package against its merge (default); a deletion only needs to know it is there. */
    verify?: boolean
}

/** The folder all of a target's packages sit in, and a package's name inside it. */
export function packageFolder(target: Pick<ExportTarget, 'pathPrefix'>, slug: string): { parent: string; name: string } {
    const parts = packageDir(target, slug).split('/')
    const name = parts.pop() as string
    return { parent: parts.join('/'), name }
}

/**
 * The base branch head and the tree ids of every package folder there: what
 * all packages of a listing share. One branch request and one folder listing,
 * where asking per package cost two of each.
 */
export async function readBaseTrees(
    client: GitLabClient,
    projectId: number,
    target: ExportTarget,
): Promise<{ head: string | undefined; trees: Map<string, string> }> {
    const head = await branchHead(client, projectId, target.baseBranch)
    if (!head) return { head, trees: new Map() }
    return { head, trees: await directoryTrees(client, projectId, packageFolder(target, 'x').parent, head) }
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
    const [requests, removals] = await Promise.all([
        findMergeRequests(client, project.id, bundleBranch(slug, version)),
        findMergeRequests(client, project.id, removalBranch(slug, version)),
    ])
    // An open request answers on its own, so the base branch is only asked without one.
    const head = requests.some((mr) => mr.state === 'opened') ? undefined : await branchHead(client, project.id, target.baseBranch)
    const dir = packageDir(target, slug)
    return inspectBundleIn(client, target, slug, version, expectedId, {
        projectId: project.id,
        requests,
        head,
        treeOnBase: () => (head ? treeIdOf(client, project.id, dir, head) : Promise.resolve(undefined)),
        removal: removals[0],
    })
}

/** {@link inspectBundle} on what a caller has read already, so a listing asks each shared question once. */
export async function inspectBundleIn(
    client: GitLabClient,
    target: ExportTarget,
    slug: string,
    version: string,
    expectedId: string | undefined,
    context: BundleContext,
): Promise<BundleInspection> {
    const { projectId, requests, head } = context
    const open = requests.find((mr) => mr.state === 'opened')
    if (open) return { status: { state: 'mr-open', mrUrl: open.web_url } }

    const removal = context.removal ? { removal: { state: context.removal.state, mrUrl: context.removal.web_url } } : {}
    if (!head) {
        return { status: { state: 'none', reason: 'no-base-branch', detail: `Branch ${target.baseBranch} existiert nicht in ${target.url}`, ...removal } }
    }
    const dir = packageDir(target, slug)
    const manifestRaw = await readFile(client, projectId, `${dir}/core-ir/manifest.json`, head)
    if (!manifestRaw) return { status: { state: 'none', reason: 'no-package', ...removal } }

    let manifest: { id?: unknown; version?: unknown }
    try {
        manifest = JSON.parse(manifestRaw) as { id?: unknown; version?: unknown }
    } catch {
        return { status: { state: 'none', reason: 'bad-manifest', detail: 'manifest.json auf dem Basisbranch ist kein gültiges JSON', ...removal } }
    }
    const idMatches =
        expectedId !== undefined
            ? manifest.id === expectedId
            : typeof manifest.id === 'string' && manifest.id.endsWith(`:usecase:${slug}`)
    if (!idMatches || manifest.version !== version) {
        return {
            status: {
                state: 'none',
                reason: 'other-version',
                onBase: { id: String(manifest.id), version: String(manifest.version) },
                detail: `Auf ${target.baseBranch} liegt ${String(manifest.id)} ${String(manifest.version)}, nicht ${expectedId ?? slug} ${version}`,
                ...removal,
            },
        }
    }

    if (context.verify === false) {
        return { status: { state: 'on-base', sha: head, packageId: String(manifest.id), ...removal }, manifestRaw }
    }
    const merged = requests.find((mr) => mr.state === 'merged')
    const verification = judgeBundle(merged, await readTrees(client, projectId, dir, context.treeOnBase, merged))
    return {
        status: { state: 'on-base', sha: head, packageId: String(manifest.id), verification, ...removal },
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
    const openRequests = (await findMergeRequests(client, project.id, catalogBranch(slug, version))).filter(
        (mr) => mr.state === 'opened',
    )
    // As above: with an open request the index is not needed.
    const index = openRequests.length > 0 ? undefined : await readFile(client, project.id, 'index.json', catalog.baseBranch)
    return catalogStatusIn({ openRequests, index }, slug, version, id)
}

/** What the catalogue step needs from the catalogue repository, read once for a whole listing. */
export interface CatalogContext {
    /** Open merge requests into the catalogue repository, any author. */
    openRequests: MergeRequestRef[]
    /** `index.json` on the catalogue's base branch; undefined when it does not exist. */
    index: string | undefined
}

/** Where a package stands in the catalogue, from what was read. Pure, so every outcome is testable. */
export function catalogStatusIn(context: CatalogContext, slug: string, version: string, id: string): CatalogStatus {
    const branch = catalogBranch(slug, version)
    const open = context.openRequests.find((mr) => mr.source_branch === branch && mr.state === 'opened')
    if (open) return { state: 'mr-open', mrUrl: open.web_url }
    if (context.index && isListed(context.index, id, version)) return { state: 'listed' }
    return { state: 'none' }
}
