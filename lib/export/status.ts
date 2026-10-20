import { indexRowOf, isListed } from '@/lib/export/catalog-entry'
import { bundleBranch, catalogBranch, packageDir, parseCatalogBranch, removalBranch, type CatalogRepo, type ExportTarget } from '@/lib/export/config'
import {
    branchHead,
    currentUser,
    directoryTrees,
    findMergeRequests,
    getProject,
    listMergeRequestsBy,
    mergeRequestCommits,
    parseProjectUrl,
    readFile,
    treeIdOf,
    type GitLabClient,
    type MergeRequestRef,
} from '@/lib/export/gitlab'
import { isNewerVersion } from '@/lib/export/share-stages'

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

/**
 * - `withdrawn`: the catalogue team took this version out, or the whole entry (see `takenOutIn`) - it is never proposed again
 */
export interface CatalogStatus {
    state: 'unconfigured' | 'none' | 'mr-open' | 'listed' | 'withdrawn'
    mrUrl?: string
    /**
     * A version of the package the catalogue team took out, with their reason
     * when the index gives one. On `withdrawn` it is this version, or the
     * whole entry is out; on `none` it is another version, and this one may
     * still be proposed; on `mr-open` see `bringsBack`.
     */
    takenOut?: { version: string; reason?: string }
    /** For `mr-open`: taking the proposal in would bring back what the catalogue team took out. */
    bringsBack?: boolean
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
    /** For a package on the base branch: the newest merged request from its branch, whose description names its source. */
    merged?: MergeRequestRef
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
        return { status: { state: 'none', reason: 'no-base-branch', detail: `Im Ablageort ${target.url} fehlt „${target.baseBranch}“`, ...removal } }
    }
    const dir = packageDir(target, slug)
    const manifestRaw = await readFile(client, projectId, `${dir}/core-ir/manifest.json`, head)
    if (!manifestRaw) return { status: { state: 'none', reason: 'no-package', ...removal } }

    let manifest: { id?: unknown; version?: unknown }
    try {
        manifest = JSON.parse(manifestRaw) as { id?: unknown; version?: unknown }
    } catch {
        return { status: { state: 'none', reason: 'bad-manifest', detail: 'Die manifest.json im Ablageort ist kein gültiges JSON', ...removal } }
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
                // In the person's words, without the URN: what is accepted, or that the folder holds another package.
                detail: idMatches ? `Angenommen ist Version ${String(manifest.version)}, nicht ${version}` : 'Im Ablageort liegt unter diesem Kurznamen ein anderes Paket',
                ...removal,
            },
        }
    }

    const merged = requests.find((mr) => mr.state === 'merged')
    const mergedRef = merged ? { merged } : {}
    if (context.verify === false) {
        return { status: { state: 'on-base', sha: head, packageId: String(manifest.id), ...removal }, manifestRaw, ...mergedRef }
    }
    const verification = judgeBundle(merged, await readTrees(client, projectId, dir, context.treeOnBase, merged))
    return {
        status: { state: 'on-base', sha: head, packageId: String(manifest.id), verification, ...removal },
        manifestRaw,
        ...mergedRef,
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

/** What `readCatalogStatus` reports, plus the highest version that reached the catalogue already (see `catalogFloor`). */
export interface CatalogInspection {
    status: CatalogStatus
    floor?: string
}

export async function inspectCatalog(
    client: GitLabClient,
    catalog: CatalogRepo | undefined,
    slug: string,
    version: string,
    id: string,
): Promise<CatalogInspection> {
    if (!catalog) return { status: { state: 'unconfigured' } }
    const project = await getProject(client, parseProjectUrl(catalog.url).projectPath)
    const context = await readVersionCatalog(client, project.id, catalog, slug, version)
    const floor = catalogFloor(context, id)
    return { status: catalogStatusIn(context, slug, version, id), ...(floor ? { floor } : {}) }
}

export async function readCatalogStatus(
    client: GitLabClient,
    catalog: CatalogRepo | undefined,
    slug: string,
    version: string,
    id: string,
): Promise<CatalogStatus> {
    return (await inspectCatalog(client, catalog, slug, version, id)).status
}

/**
 * The catalogue's side of one version, read fresh: the proposals from its
 * branch, the index, and - unless `others` is false - the bot's merged
 * proposals of other versions, to know which of them the catalogue team took
 * out again. The index is read even next to an open proposal: whether that
 * proposal would bring back a version taken out depends on it.
 */
export async function readVersionCatalog(
    client: GitLabClient,
    projectId: number,
    catalog: CatalogRepo,
    slug: string,
    version: string,
    others = true,
): Promise<CatalogContext> {
    const [requests, index, byBot] = await Promise.all([
        findMergeRequests(client, projectId, catalogBranch(slug, version)),
        readFile(client, projectId, 'index.json', catalog.baseBranch),
        others ? currentUser(client).then((bot) => listMergeRequestsBy(client, projectId, bot.id)) : Promise.resolve([]),
    ])
    const merged = new Map([...requests, ...byBot].filter((mr) => mr.state === 'merged').map((mr) => [mr.iid, mr]))
    return { openRequests: requests.filter((mr) => mr.state === 'opened'), index, merged: [...merged.values()] }
}

/** What the catalogue step needs from the catalogue repository, read once for a whole listing. */
export interface CatalogContext {
    /** Open merge requests into the catalogue repository, any author. */
    openRequests: MergeRequestRef[]
    /** `index.json` on the catalogue's base branch; undefined when it does not exist. */
    index: string | undefined
    /**
     * Merged merge requests into the catalogue repository: from their
     * `catalog/…` branches, what was listed once. Absent when not read - then
     * nothing counts as taken out by hand.
     */
    merged?: MergeRequestRef[]
}

/** The versions of `id` that a merged proposal put into the catalogue. The branch names no publisher; the description names the id. */
function listedOnce(context: CatalogContext, id: string): string[] {
    return (context.merged ?? []).flatMap((mr) => {
        const branch = parseCatalogBranch(mr.source_branch)
        return branch && mr.description?.includes(`\`${id}\``) ? [branch.version] : []
    })
}

/** The highest plain x.y.z among `versions`: anything else could never be compared, and so never be passed. */
const newest = (versions: string[]): string | undefined =>
    versions
        .filter((candidate) => /^\d+\.\d+\.\d+$/.test(candidate))
        .reduce<string | undefined>((best, candidate) => (!best || isNewerVersion(candidate, best) ? candidate : best), undefined)

/**
 * What the catalogue team took out of the catalogue (decided 2026-10-18): a
 * row marked `revoked` takes out the whole entry; a version listed once
 * through a merged proposal, of which neither it nor a newer version is
 * listed now, was deleted from the index by hand (the cb4d433 case). A
 * version taken out is never proposed for the catalogue again - the curators'
 * decision is not undone silently - while a new version still may be.
 * `thisVersion` says whether `version` is what is out. Undefined when nothing
 * was taken out, or the index cannot be read.
 */
export function takenOutIn(
    context: CatalogContext,
    id: string,
    version: string,
): { version: string; reason?: string; thisVersion: boolean } | undefined {
    if (context.index === undefined) return undefined
    const row = indexRowOf(context.index, id)
    if (row === null) return undefined
    if (row?.revoked) return { version: row.version ?? version, ...(row.reason ? { reason: row.reason } : {}), thisVersion: true }
    // Replaced, not taken out: the index lists it, or a newer version of it.
    const listedNow = row?.version
    const out = listedOnce(context, id).filter((candidate) => !(listedNow && (listedNow === candidate || isNewerVersion(listedNow, candidate))))
    if (out.includes(version)) return { version, thisVersion: true }
    const other = newest(out)
    return other ? { version: other, thisVersion: false } : undefined
}

/**
 * The highest version of the package that reached the catalogue: the one its
 * row names, listed or withdrawn, or one listed once and taken out since. A
 * version that was in the catalogue is used up, so a new one has to be
 * higher. Undefined when none did, or the index cannot be read.
 */
export function catalogFloor(context: CatalogContext, id: string): string | undefined {
    if (context.index === undefined) return undefined
    const row = indexRowOf(context.index, id)
    if (row === null) return undefined
    return newest([...(row?.version ? [row.version] : []), ...listedOnce(context, id)])
}

/** Where a package stands in the catalogue, from what was read. Pure, so every outcome is testable. */
export function catalogStatusIn(context: CatalogContext, slug: string, version: string, id: string): CatalogStatus {
    const out = takenOutIn(context, id, version)
    const takenOut = out ? { takenOut: { version: out.version, ...(out.reason ? { reason: out.reason } : {}) } } : {}
    const branch = catalogBranch(slug, version)
    const open = context.openRequests.find((mr) => mr.source_branch === branch && mr.state === 'opened')
    if (open) return { state: 'mr-open', mrUrl: open.web_url, ...takenOut, ...(out?.thisVersion ? { bringsBack: true } : {}) }
    if (context.index && isListed(context.index, id, version)) return { state: 'listed' }
    if (out?.thisVersion) return { state: 'withdrawn', ...takenOut }
    return { state: 'none', ...takenOut }
}
