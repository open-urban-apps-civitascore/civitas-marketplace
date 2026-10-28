import { expireCatalogIfOlder } from '@/lib/catalog/source'
import { mapWithLimit } from '@/lib/concurrency'
import {
    catalogBranch,
    catalogRepoFromEnv,
    exportConfig,
    exportReadiness,
    packageDir,
    parseBundleBranch,
    parseCatalogBranch,
    parseRemovalBranch,
    thisInstance,
    type CatalogRepo,
    type ExportConfig,
    type ExportTarget,
} from '@/lib/export/config'
import { declinedProposal, declineOf, type Decline } from '@/lib/export/declines'
import {
    AUTHOR_PAGES,
    clientFor,
    currentUser,
    getProject,
    GitLabError,
    gitlabMessage,
    listMergeRequestsBy,
    listOpenMergeRequests,
    parseProjectUrl,
    readClosing,
    readFile,
    type Closing,
    type GitLabClient,
    type GitLabProject,
    type MergeRequestRef,
} from '@/lib/export/gitlab'
import { catalogPinOf, displayNameOf, proposerOf, readmeSourceOf, shareSourceOf, type DeclineReason, type ShareSource } from '@/lib/export/merge-request-text'
import { SHARE_READS } from '@/lib/export/share-cache'
import { catalogStatusIn, inspectBundleIn, packageFolder, presentRequests, readBaseTrees, type BundleStatus, type CatalogContext, type CatalogStatus } from '@/lib/export/status'

// What the bot account proposed and where each shared version stands, read from GitLab on every visit.
// Served by `GET /api/shares`, not a server action: Next runs a page's server actions one at a time.

export interface ShareProposal {
    kind: 'bundle' | 'catalog' | 'removal'
    iid: number
    url: string
    state: string
    createdAt?: string
    closedAt?: string
    mergedAt?: string
    /** GitLab username. */
    closedBy?: string
    /** GitLab username. */
    mergedBy?: string
    /** Also a close by hand through the bot account; only `withdrawnBy` means withdrawn. */
    closedByBot?: boolean
    proposedBy?: string
    withdrawnBy?: string
    reason?: DeclineReason
    comments?: number
    source?: ShareSource
}

export interface SharedPackageRow {
    /** `<target url>#<branch>` */
    key: string
    targetKey: string
    targetLabel: string
    slug: string
    version: string
    displayName: string
    /** Open, else merged, else newest. */
    bundleMr: { url: string; state: string }
    withdrawn?: boolean
    bundle?: BundleStatus
    catalog?: CatalogStatus
    packageId?: string
    problem?: string
    folderUrl?: string
    source?: ShareSource
    proposedBy?: string
    proposals?: ShareProposal[]
}

export interface ShareListing {
    rows: SharedPackageRow[]
    instance?: string
    /** Link to older proposals at GitLab; set only where the listing was cut at `AUTHOR_PAGES`. */
    older?: string
    error?: string
}

export function olderProposalsUrl(projectUrl: string, account: string): string {
    return `${projectUrl.replace(/\/+$/, '')}/-/merge_requests?scope=all&state=all&author_username=${encodeURIComponent(account)}`
}

const ROW_CONCURRENCY = 5

/** Asked once per visit: target and catalogue are often the same repository. */
interface Visit {
    project: (client: GitLabClient, url: string) => Promise<GitLabProject>
    bot: (client: GitLabClient) => Promise<{ id: number; username: string }>
    botRequests: (client: GitLabClient, project: GitLabProject) => Promise<MergeRequestRef[]>
    /** Project URL to account name, where the proposals were cut at `AUTHOR_PAGES`. */
    cut: Map<string, string>
}

function newVisit(): Visit {
    const asked = new Map<string, Promise<unknown>>()
    const once = <T>(key: string, load: () => Promise<T>): Promise<T> => {
        let answer = asked.get(key) as Promise<T> | undefined
        if (!answer) {
            answer = load()
            asked.set(key, answer)
        }
        return answer
    }
    const visit: Visit = {
        // For the server's life: neither a project's id nor the token's account changes.
        project: (client, url) => {
            const path = parseProjectUrl(url).projectPath
            return SHARE_READS.read(`${client.apiBase}|project|${path}`, () => getProject(client, path))
        },
        bot: (client) => SHARE_READS.read(`${client.apiBase}|bot`, () => currentUser(client)),
        botRequests: (client, project) =>
            once(`${client.apiBase}|requests|${project.id}`, async () => {
                const bot = await visit.bot(client)
                const requests = await listMergeRequestsBy(client, project.id, bot.id)
                if (requests.length >= AUTHOR_PAGES * 100) visit.cut.set(project.web_url, bot.username)
                return requests
            }),
        cut: new Map(),
    }
    return visit
}

/** Prefers a package target over the catalogue: most endings are about packages. */
function olderOf(visit: Visit, targets: readonly ExportTarget[]): string | undefined {
    const cut = [...visit.cut]
    const [url, account] = cut.find(([project]) => targets.some((target) => sameProjectUrl(project, target.url))) ?? cut[0] ?? []
    return url && account ? olderProposalsUrl(url, account) : undefined
}

interface CatalogSide {
    context: CatalogContext
    client: GitLabClient
    projectId: number
    byBot: MergeRequestRef[]
    botId: number
}

interface TargetContext {
    target: ExportTarget
    client: GitLabClient
    projectId: number
    botId: number
    base: Promise<{ head: string | undefined; trees: Map<string, string> }>
    catalog: Promise<CatalogSide | undefined>
    removals: Map<string, MergeRequestRef[]>
}

/** Checks no session or right: `app/api/shares/route.ts` does. */
export async function readShareListing(config: ExportConfig = exportConfig()): Promise<ShareListing> {
    const instance = thisInstance()
    const named = instance ? { instance } : {}
    if (exportReadiness(config) !== 'ready') return { rows: [], ...named }
    const token = config.token as string
    const visit = newVisit()

    // Started now and awaited by the rows, which report its failure.
    const catalog = readCatalogSide(config.catalog, token, visit)
    catalog.catch(() => {})

    try {
        const rows: SharedPackageRow[] = []
        for (const target of config.targets) rows.push(...(await sharedRowsOf(target, token, visit, catalog)))
        // Before `olderOf`: the catalogue's proposals can be cut too.
        await catalog.catch(() => undefined)
        const older = olderOf(visit, config.targets)
        return { rows, ...named, ...(older ? { older } : {}) }
    } catch (error) {
        if (error instanceof GitLabError) return { rows: [], ...named, error: gitlabMessage(error) }
        throw error
    }
}

async function sharedRowsOf(target: ExportTarget, token: string, visit: Visit, catalog: Promise<CatalogSide | undefined>): Promise<SharedPackageRow[]> {
    const client: GitLabClient = { ...clientFor(target.url, token), cache: SHARE_READS }
    const [project, bot] = await Promise.all([visit.project(client, target.url), visit.bot(client)])
    const base = readBaseTrees(client, project.id, target)
    base.catch(() => {})
    const requests = await visit.botRequests(client, project)

    // The bot names the export and removal branches, so its own requests are all there are from them.
    const byBranch = new Map<string, MergeRequestRef[]>()
    const removals = new Map<string, MergeRequestRef[]>()
    const add = <K>(map: Map<K, MergeRequestRef[]>, key: K, mr: MergeRequestRef) => {
        const known = map.get(key)
        if (known) known.push(mr)
        else map.set(key, [mr])
    }
    for (const mr of requests) {
        const removal = parseRemovalBranch(mr.source_branch)
        if (removal) add(removals, `${removal.slug}@${removal.version}`, mr)
        else if (parseBundleBranch(mr.source_branch)) add(byBranch, mr.source_branch, mr)
    }
    const context: TargetContext = { target, client, projectId: project.id, botId: bot.id, base, catalog, removals }
    return mapWithLimit([...byBranch.values()], ROW_CONCURRENCY, (branchRequests) => sharedPackageRow(context, branchRequests))
}

async function sharedPackageRow(context: TargetContext, requests: MergeRequestRef[]): Promise<SharedPackageRow> {
    const { target } = context
    const version = parseBundleBranch(requests[0].source_branch) as { slug: string; version: string }
    const removals = context.removals.get(`${version.slug}@${version.version}`) ?? []
    // A later closed duplicate does not undo a merge; after a merged removal only newer requests count.
    const present = presentRequests(requests, removals)
    const pool = present.length ? present : requests
    const mr = pool.find((request) => request.state === 'opened') ?? pool.find((request) => request.state === 'merged') ?? pool[0]
    const ended = proposalsOf(context, version, requests, removals)
    const [state, proposals, source] = await Promise.all([
        // An older merged removal was undone by the package's later merge.
        stateOf(context, version, requests, presentRequests(removals, requests)[0], mr, ended),
        ended,
        sourceOf(context, version.slug, mr),
    ])
    const own = proposals.find((proposal) => proposal.kind === 'bundle' && proposal.iid === mr.iid)
    return {
        key: `${target.key}#${mr.source_branch}`,
        targetKey: target.key,
        targetLabel: target.label,
        slug: version.slug,
        version: version.version,
        displayName: displayNameOf(mr.title, version.version) ?? version.slug,
        bundleMr: { url: mr.web_url, state: mr.state },
        folderUrl: folderHistoryUrl(target, version.slug),
        ...(mr.state === 'closed' && own?.withdrawnBy ? { withdrawn: true } : {}),
        ...state,
        ...(source ? { source } : {}),
        ...(proposerOf(mr.description) ? { proposedBy: proposerOf(mr.description) } : {}),
        proposals,
    }
}

function folderHistoryUrl(target: ExportTarget, slug: string): string {
    const encoded = (path: string) => path.split('/').map(encodeURIComponent).join('/')
    return `${target.url.replace(/\/+$/, '')}/-/commits/${encoded(target.baseBranch)}/${encoded(packageDir(target, slug))}`
}

function samePackageOnBase(bundle: BundleStatus, slug: string): string | undefined {
    const id = bundle.reason === 'other-version' ? bundle.onBase?.id : undefined
    return id?.endsWith(`:usecase:${slug}`) ? id : undefined
}

function declineAmong(proposals: ShareProposal[], kind: ShareProposal['kind']): Decline | undefined {
    const declined = declinedProposal(proposals, kind)
    return declined ? declineOf(declined) : undefined
}

async function stateOf(
    context: TargetContext,
    { slug, version }: { slug: string; version: string },
    requests: MergeRequestRef[],
    removal: MergeRequestRef | undefined,
    mr: MergeRequestRef,
    ended: Promise<ShareProposal[]>,
): Promise<Pick<SharedPackageRow, 'bundle' | 'catalog' | 'packageId' | 'problem'>> {
    if (mr.state !== 'merged') return {}
    const { target, client, projectId } = context
    try {
        const [{ head, trees }, proposals] = await Promise.all([context.base, ended])
        const removalDeclined = declineAmong(proposals, 'removal')
        const { status: bundle } = await inspectBundleIn(client, target, slug, version, undefined, {
            projectId,
            requests,
            head,
            treeOnBase: async () => trees.get(packageFolder(target, slug).name),
            removal,
            ...(removalDeclined ? { removalDeclined } : {}),
        })
        // A replaced version is asked too: it stays listed while the newer one waits for its entry.
        const packageId = bundle.packageId ?? samePackageOnBase(bundle, slug)
        if (!packageId) return { bundle }
        const side = await context.catalog
        return {
            bundle,
            catalog: side ? catalogStatusIn(side.context, slug, version, packageId, declineAmong(proposals, 'catalog')) : { state: 'unconfigured' },
            packageId,
        }
    } catch (error) {
        if (error instanceof GitLabError) return { problem: gitlabMessage(error) }
        throw error
    }
}

async function proposalsOf(
    context: TargetContext,
    { slug, version }: { slug: string; version: string },
    bundles: MergeRequestRef[],
    removals: MergeRequestRef[],
): Promise<ShareProposal[]> {
    const side = await context.catalog.catch(() => undefined)
    const branch = catalogBranch(slug, version)
    const dir = packageDir(context.target, slug)
    const entries = (side?.byBot ?? []).filter((mr) => mr.source_branch === branch && pinsHere(mr, context.target, dir))
    const here = { client: context.client, projectId: context.projectId, botId: context.botId }
    const proposals = await Promise.all([
        ...bundles.map((mr) => proposalOf('bundle', mr, here)),
        ...removals.map((mr) => proposalOf('removal', mr, here)),
        ...(side ? entries.map((mr) => proposalOf('catalog', mr, side)) : []),
    ])
    return proposals.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

const sameProjectUrl = (a: string, b: string) => a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase()

function pinsHere(mr: MergeRequestRef, target: ExportTarget, dir: string): boolean {
    const pin = catalogPinOf(mr.description)
    return !pin || (sameProjectUrl(pin.repo, target.url) && pin.path === dir)
}

async function proposalOf(
    kind: ShareProposal['kind'],
    mr: MergeRequestRef,
    where: { client: GitLabClient; projectId: number; botId: number },
): Promise<ShareProposal> {
    const closedByBot = mr.state === 'closed' && mr.closed_by?.id === where.botId
    const merger = mr.merge_user ?? mr.merged_by
    const closing = mr.state === 'closed' ? await closingOf(where.client, where.projectId, mr) : undefined
    return {
        kind,
        iid: mr.iid,
        url: mr.web_url,
        state: mr.state,
        ...(mr.created_at ? { createdAt: mr.created_at } : {}),
        ...(mr.state === 'closed' && mr.closed_at ? { closedAt: mr.closed_at } : {}),
        ...(mr.state === 'merged' && mr.merged_at ? { mergedAt: mr.merged_at } : {}),
        ...(mr.state === 'closed' && mr.closed_by?.username ? { closedBy: mr.closed_by.username } : {}),
        ...(mr.state === 'merged' && merger?.username ? { mergedBy: merger.username } : {}),
        ...(closedByBot ? { closedByBot } : {}),
        ...(proposerOf(mr.description) ? { proposedBy: proposerOf(mr.description) } : {}),
        ...(closing?.withdrawnBy ? { withdrawnBy: closing.withdrawnBy } : {}),
        ...(closing?.reason ? { reason: closing.reason } : {}),
        ...(typeof mr.user_notes_count === 'number' ? { comments: mr.user_notes_count } : {}),
        ...(shareSourceOf(mr.description) ? { source: shareSourceOf(mr.description) } : {}),
    }
}

/** Unreadable comments: not withdrawn, as GitLab shows it, with the reason "unreadable". */
async function closingOf(client: GitLabClient, projectId: number, mr: MergeRequestRef): Promise<Closing> {
    try {
        return await readClosing(client, projectId, mr)
    } catch (error) {
        if (error instanceof GitLabError) return { reason: { kind: 'unreadable' } }
        throw error
    }
}

/** The source line, else an older share's README at the request's head; never guessed from a name. */
async function sourceOf(context: TargetContext, slug: string, mr: MergeRequestRef): Promise<ShareSource | undefined> {
    const line = shareSourceOf(mr.description)
    if (line) return line
    if (!mr.sha || (mr.state !== 'merged' && mr.state !== 'opened')) return undefined
    try {
        return readmeSourceOf(await readFile(context.client, context.projectId, `${packageDir(context.target, slug)}/README.md`, mr.sha))
    } catch (error) {
        if (error instanceof GitLabError) return undefined
        throw error
    }
}

/** A newer index here also makes the catalogue pages read theirs again, where both read the same one. */
async function readCatalogSide(repo: CatalogRepo | undefined, token: string, visit: Visit): Promise<CatalogSide | undefined> {
    if (!repo) return undefined
    const client: GitLabClient = { ...clientFor(repo.url, token), cache: SHARE_READS }
    const project = await visit.project(client, repo.url)
    const [openRequests, index, byBot, bot] = await Promise.all([
        listOpenMergeRequests(client, project.id),
        readFile(client, project.id, 'index.json', repo.baseBranch),
        visit.botRequests(client, project),
        visit.bot(client),
    ])
    if (index !== undefined && servesSameIndex(repo)) expireCatalogIfOlder(index)
    return {
        context: { openRequests, index, merged: byBot.filter((mr) => mr.state === 'merged' && parseCatalogBranch(mr.source_branch)) },
        client,
        projectId: project.id,
        byBot,
        botId: bot.id,
    }
}

export function servesSameIndex(repo: CatalogRepo, env: Record<string, string | undefined> = process.env): boolean {
    const served = catalogRepoFromEnv({ REPO_LIST_URL: env.REPO_LIST_URL })
    return Boolean(served && sameProjectUrl(served.url, repo.url) && served.baseBranch === repo.baseBranch)
}
