import { indexRowOf, isListed, maintainerOf } from '@/lib/export/catalog-entry'
import { bundleBranch, catalogBranch, packageDir, parseCatalogBranch, removalBranch, type CatalogRepo, type ExportTarget } from '@/lib/export/config'
import { sinceStart, startedOver, type Decline } from '@/lib/export/declines'
import {
    branchHead,
    currentUser,
    directoryTrees,
    findMergeRequests,
    getProject,
    GitLabError,
    listMergeRequestsBy,
    mergeRequestCommits,
    newestFirst,
    parseProjectUrl,
    readClosing,
    readFile,
    treeIdOf,
    type Closing,
    type GitLabClient,
    type MergeRequestRef,
} from '@/lib/export/gitlab'
import type { DeclineReason } from '@/lib/export/merge-request-text'
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
    /** For state `none`: its newest package proposal was turned down, so the version is used up; `mrUrl` names that proposal. */
    declined?: Decline
    /**
     * The newest proposal to take this version out of the repository again
     * ("Zurückziehen" in "In Arbeit"), whatever became of it; `declined` when
     * it was turned down, and the package stays. Not read while the version
     * has an open merge request: a new proposal comes first.
     */
    removal?: { state: string; mrUrl: string; declined?: Decline }
}

/**
 * - `withdrawn`: the catalogue team took this version out, or the whole entry (see `takenOutIn`) - it is never proposed again
 * - `declined`: the catalogue team did not take this version's entry - it is not proposed again for this version
 *
 * An open proposal comes first, then what the index says (listed or taken
 * out), then a "no" to an entry that never got in.
 */
export interface CatalogStatus {
    state: 'unconfigured' | 'none' | 'mr-open' | 'listed' | 'withdrawn' | 'declined'
    /** The open proposal, or for `declined` the one turned down. */
    mrUrl?: string
    /** For `declined`: who turned the entry down, when and why. */
    declined?: Decline
    /**
     * A version of the package the catalogue team took out, with their reason
     * when the index gives one. On `withdrawn` it is this version, or the
     * whole entry is out; on `none` it is another version, and this one may
     * still be proposed; on `mr-open` see `bringsBack`.
     */
    takenOut?: { version: string; reason?: string }
    /** For `mr-open`: taking the proposal in would bring back what the catalogue team took out. */
    bringsBack?: boolean
    /** For `listed`: the Herausgeber in the catalogue row (`maintainer`), shown in „Veröffentlicht“. */
    maintainer?: string
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
    /** That removal was turned down (`readDecline`). */
    removalDeclined?: Decline
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

/** A "no" with unreadable comments: `tell` for a reading the page shows, `throw` for a refusal, which never rests on a guess. */
export interface DeclineReading {
    unreadable?: 'throw' | 'tell'
}

/**
 * `expectedId` pins the package id when the caller knows it (the export
 * form). Without it, as for a listed share, any `urn:…:usecase:<slug>` of
 * that version counts. `reading` applies to the "no" to the package; one to
 * its removal is always told, as the marketplace never withdraws removals.
 */
export async function inspectBundle(
    client: GitLabClient,
    target: ExportTarget,
    slug: string,
    version: string,
    expectedId?: string,
    reading: DeclineReading = {},
): Promise<BundleInspection> {
    const project = await getProject(client, parseProjectUrl(target.url).projectPath)
    const [requests, removals] = await Promise.all([
        findMergeRequests(client, project.id, bundleBranch(slug, version)),
        findMergeRequests(client, project.id, removalBranch(slug, version)),
    ])
    // An open request answers on its own, so the base branch is only asked without one.
    if (requests.some((mr) => mr.state === 'opened')) {
        return inspectBundleIn(client, target, slug, version, expectedId, { projectId: project.id, requests, head: undefined, treeOnBase: async () => undefined })
    }
    const bot = lazyAccount(client)
    // The removals since the package was last merged: an older one, merged, was undone by that merge.
    const presentRemovals = presentRequests(removals, requests)
    // A "no" to the removal stops nothing else: unreadable comments only leave its reason unknown.
    const [head, removalDeclined] = await Promise.all([
        branchHead(client, project.id, target.baseBranch),
        readDecline(client, project.id, presentRemovals, bot, 'tell'),
    ])
    const dir = packageDir(target, slug)
    const inspection = await inspectBundleIn(client, target, slug, version, expectedId, {
        projectId: project.id,
        requests,
        head,
        treeOnBase: () => (head ? treeIdOf(client, project.id, dir, head) : Promise.resolve(undefined)),
        removal: presentRemovals[0],
        ...(removalDeclined ? { removalDeclined } : {}),
    })
    if (inspection.status.state !== 'none') return inspection
    // Not on the base branch: maybe its package was turned down since the version last started over.
    const declined = await readDecline(client, project.id, presentRequests(requests, removals), bot, reading.unreadable)
    return declined ? { ...inspection, status: { ...inspection.status, declined, mrUrl: declined.mrUrl } } : inspection
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

    const declined = context.removalDeclined ? { declined: context.removalDeclined } : {}
    const removal = context.removal ? { removal: { state: context.removal.state, mrUrl: context.removal.web_url, ...declined } } : {}
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
    reading: DeclineReading = {},
): Promise<BundleStatus> {
    return (await inspectBundle(client, target, slug, version, expectedId, reading)).status
}

/** What `readCatalogStatus` reports, plus the highest version that reached the catalogue already (see `catalogFloor`). */
export interface CatalogInspection {
    status: CatalogStatus
    floor?: string
    /** The `index.json` this inspection read, for reuse in the same request (`readVersionCatalog`). */
    read?: { index: string | undefined }
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
    const bot = lazyAccount(client)
    const context = await readVersionCatalog(client, project.id, catalog, slug, version, true, bot)
    const floor = catalogFloor(context, id)
    const declined = await readCatalogDecline(client, project.id, context, id, bot)
    return { status: catalogStatusIn(context, slug, version, id, declined), ...(floor ? { floor } : {}), read: { index: context.index } }
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
 * proposal would bring back a version taken out depends on it. `bot` shares
 * the caller's account lookup.
 */
export async function readVersionCatalog(
    client: GitLabClient,
    projectId: number,
    catalog: CatalogRepo,
    slug: string,
    version: string,
    others = true,
    bot: () => Promise<{ id: number }> = lazyAccount(client),
    /** The index already read in this request (`CatalogInspection.read`). */
    known?: { index: string | undefined },
): Promise<CatalogContext> {
    const [requests, index, byBot] = await Promise.all([
        findMergeRequests(client, projectId, catalogBranch(slug, version)),
        known ? Promise.resolve(known.index) : readFile(client, projectId, 'index.json', catalog.baseBranch),
        others ? bot().then((account) => listMergeRequestsBy(client, projectId, account.id)) : Promise.resolve([]),
    ])
    const merged = new Map([...requests, ...byBot].filter((mr) => mr.state === 'merged').map((mr) => [mr.iid, mr]))
    return { openRequests: requests.filter((mr) => mr.state === 'opened'), index, merged: [...merged.values()], requests }
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
    /** One version's reading only: every request from its catalogue branch, newest first, for its "no" (`readCatalogDecline`). */
    requests?: MergeRequestRef[]
}

/** The token's account, asked once and only when needed: most readings never do. */
export function lazyAccount(client: GitLabClient): () => Promise<{ id: number; username: string }> {
    let account: Promise<{ id: number; username: string }> | undefined
    return () => (account ??= currentUser(client))
}

/** Who closed a request, as a "no" tells it. */
function declineOfRequest(mr: MergeRequestRef, botId: number, reason: DeclineReason): Decline {
    return {
        iid: mr.iid,
        mrUrl: mr.web_url,
        ...(mr.closed_at ? { closedAt: mr.closed_at } : {}),
        ...(mr.closed_by?.username ? { closedBy: mr.closed_by.username } : {}),
        ...(mr.closed_by?.id === botId ? { viaMarketplace: true } : {}),
        reason,
    }
}

/**
 * A branch's requests opened after the newest merge among `other` (the
 * removals for package requests, and the other way round); all without one.
 */
export function presentRequests(requests: MergeRequestRef[], other: readonly MergeRequestRef[]): MergeRequestRef[] {
    const since = startedOver(other.filter((mr) => mr.state === 'merged').map((mr) => mr.merged_at ?? mr.created_at))
    return since === undefined ? requests : requests.filter((mr) => sinceStart(mr.created_at, since))
}

/**
 * The catalogue team's "no" on one branch: the newest of the marketplace's own
 * proposals in `requests`, closed without being withdrawn, while nothing from
 * the branch was merged (a merge beats a later closed duplicate).
 *
 * Unreadable comments give the reason `unreadable`. Only the account
 * withdraws, so a close by anyone else is a "no" either way; one by the
 * account may be an older withdrawal from before the mark: `throw` fails
 * rather than guess, `tell` reports the "no" anyway.
 */
export async function readDecline(
    client: GitLabClient,
    projectId: number,
    requests: MergeRequestRef[],
    bot: () => Promise<{ id: number }>,
    unreadable: 'throw' | 'tell' = 'tell',
): Promise<Decline | undefined> {
    if (requests.some((mr) => mr.state === 'merged') || !requests.some((mr) => mr.state === 'closed')) return undefined
    const { id } = await bot()
    const newest = newestFirst(requests.filter((mr) => mr.author?.id === id))[0]
    if (newest?.state !== 'closed') return undefined
    let closing: Closing
    try {
        closing = await readClosing(client, projectId, newest)
    } catch (error) {
        const byOther = typeof newest.closed_by?.id === 'number' && newest.closed_by.id !== id
        if (!(error instanceof GitLabError) || (unreadable === 'throw' && !byOther)) throw error
        closing = { reason: { kind: 'unreadable' } }
    }
    return closing.withdrawnBy ? undefined : declineOfRequest(newest, id, closing.reason ?? { kind: 'none' })
}

/**
 * The "no" to one version's entry. The branch names no publisher, so only
 * proposals whose description names this id, or that have none, count.
 */
export function readCatalogDecline(
    client: GitLabClient,
    projectId: number,
    context: CatalogContext,
    id: string,
    bot: () => Promise<{ id: number }>,
    unreadable: 'throw' | 'tell' = 'tell',
): Promise<Decline | undefined> {
    const own = (context.requests ?? []).filter((mr) => !mr.description || mr.description.includes(`\`${id}\``))
    return readDecline(client, projectId, own, bot, unreadable)
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

/**
 * Where a package stands in the catalogue, from what was read: open, listed,
 * taken out, turned down (`declined`, as the caller found it), none - in this
 * order, so a version taken out never reads as turned down. Pure, so every
 * outcome is testable.
 */
export function catalogStatusIn(context: CatalogContext, slug: string, version: string, id: string, declined?: Decline): CatalogStatus {
    const out = takenOutIn(context, id, version)
    const takenOut = out ? { takenOut: { version: out.version, ...(out.reason ? { reason: out.reason } : {}) } } : {}
    const branch = catalogBranch(slug, version)
    const open = context.openRequests.find((mr) => mr.source_branch === branch && mr.state === 'opened')
    if (open) return { state: 'mr-open', mrUrl: open.web_url, ...takenOut, ...(out?.thisVersion ? { bringsBack: true } : {}) }
    if (context.index && isListed(context.index, id, version)) {
        const maintainer = maintainerOf(context.index, id)
        return { state: 'listed', ...(maintainer ? { maintainer } : {}) }
    }
    if (out?.thisVersion) return { state: 'withdrawn', ...takenOut }
    if (declined) return { state: 'declined', mrUrl: declined.mrUrl, declined, ...takenOut }
    return { state: 'none', ...takenOut }
}
