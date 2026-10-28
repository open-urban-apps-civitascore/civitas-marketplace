import { createHash } from 'node:crypto'

import { isListed } from '@/lib/export/catalog-entry'
import { bundleBranch, catalogBranch, packageDir, removalBranch, thisInstance, type CatalogRepo, type ExportConfig, type ExportTarget } from '@/lib/export/config'
import {
    branchHead,
    clientFor,
    commitBefore,
    currentUser,
    findMergeRequests,
    getProject,
    GitLabError,
    listBlobs,
    openMergeRequest,
    parseProjectUrl,
    readFile,
    withdrawMergeRequest,
    type GitLabClient,
    type GitLabProject,
    type MergeRequestRef,
} from '@/lib/export/gitlab'
import { removalRefusal } from '@/lib/export/declines'
import { displayNameOf, proposedByOther, proposerOf, shareSourceLine, shareSourceOf, withdrawalMark } from '@/lib/export/merge-request-text'
import { SHARE_READS } from '@/lib/export/share-cache'
import { mergeRequestRef } from '@/lib/export/share-state'
import { inspectBundleIn, presentRequests, readDecline, takenOutIn, type BundleStatus } from '@/lib/export/status'

// "Zurückziehen" for one version: withdraw what is proposed; propose removing a merged, unlisted one.
// Read and run in two steps: the action runs only while a fresh reading yields the confirmed fingerprint.

/** `withdraw` only closes proposals; `remove` also proposes removing the version; `none`: see `reason`. */
export type DeletionKind = 'withdraw' | 'remove' | 'none'

/** Where a merged version has an open proposal: withdraw only that (`proposal`), or the version too. */
export type DeletionScope = 'proposal' | 'version'

export const DELETION_SCOPES: readonly DeletionScope[] = ['proposal', 'version']

export interface DeletionPlan {
    kind: DeletionKind
    closes: { what: 'bundle' | 'catalog'; ref: string; url: string }[]
    listed?: boolean
    takenOut?: boolean
    accepted?: boolean
    scope?: DeletionScope
    /** `previous`: the folder held something before the merge; `restores`: that version. */
    removal?: { folder: string; previous: boolean; restores?: string; files: number; mergedUrl: string }
    reason?: string
    mrUrl?: string
    proposedBy?: string
    /** Proposed for someone other than the person asking. */
    byOther?: boolean
    fingerprint: string
}

export interface DeletionResult {
    status: 'ok' | 'changed' | 'unchanged' | 'error' | 'forbidden' | 'unconfigured' | 'invalid'
    detail: string
    mrUrl?: string
    /** The current plan, when it no longer matches the confirmed one. */
    plan?: DeletionPlan
    alternative?: DeletionPlan
    /** Failed after closing something, which stays closed. */
    partial?: boolean
}

export interface DeletionWork {
    closes: { client: GitLabClient; projectId: number; mr: MergeRequestRef; what: 'bundle' | 'catalog' }[]
    removal?: {
        client: GitLabClient
        project: GitLabProject
        target: ExportTarget
        slug: string
        version: string
        displayName: string
        /** Commit the folder goes back to: the base branch just before the version's merge. */
        before: string
        written: string[]
        deleted: string[]
        existing: Set<string>
        catalogueChecked: boolean
        datasetId?: string
    }
}

const ref = (mr: MergeRequestRef) => mergeRequestRef(mr.web_url) ?? `!${mr.iid}`

export function fileCount(count: number): string {
    return `${count} ${count === 1 ? 'Datei' : 'Dateien'}`
}

function fingerprintOf(plan: Omit<DeletionPlan, 'fingerprint' | 'byOther'>, detail: unknown): string {
    // The flags change the dialog's words, and the person confirmed those words.
    const words = [plan.scope ?? '', Boolean(plan.listed), Boolean(plan.takenOut), Boolean(plan.accepted)]
    return createHash('sha256').update(JSON.stringify([plan.kind, plan.closes.map((close) => close.url), plan.reason ?? '', ...words, detail])).digest('hex').slice(0, 32)
}

async function readCatalogSide(
    repo: CatalogRepo,
    token: string,
    slug: string,
    version: string,
    packageId: string | undefined,
    target: { client: GitLabClient; project: GitLabProject },
) {
    const same = clientFor(repo.url, token).apiBase === target.client.apiBase && parseProjectUrl(repo.url).projectPath === target.project.path_with_namespace
    const client: GitLabClient = same ? target.client : { ...clientFor(repo.url, token), cache: SHARE_READS }
    const project = same ? target.project : await getProject(client, parseProjectUrl(repo.url).projectPath)
    const [requests, index] = await Promise.all([
        findMergeRequests(client, project.id, catalogBranch(slug, version)),
        readFile(client, project.id, 'index.json', repo.baseBranch),
    ])
    const opened = requests.filter((mr) => mr.state === 'opened')
    const merged = requests.filter((mr) => mr.state === 'merged')
    // Only this version's withdrawn entry counts; another version's leaves this one removable.
    const out = packageId ? takenOutIn({ openRequests: opened, index, merged }, packageId, version) : undefined
    return {
        client,
        projectId: project.id,
        opened,
        listed: Boolean(index && packageId && isListed(index, packageId, version)),
        takenOut: Boolean(out?.thisVersion && out.version === version),
    }
}

function versionIn(manifestRaw: string | undefined): string | undefined {
    try {
        const version = manifestRaw ? (JSON.parse(manifestRaw) as { version?: unknown }).version : undefined
        return typeof version === 'string' ? version : undefined
    } catch {
        return undefined
    }
}

function notThere(bundle: BundleStatus): string {
    switch (bundle.reason) {
        case 'no-base-branch':
            return `${bundle.detail ?? 'Der Ablageort ist nicht vollständig eingerichtet'} - das richtet der Betrieb ein, von hier wird nichts zurückgezogen.`
        case 'bad-manifest':
            return 'Im Ablageort liegt ein Paketordner mit einer manifest.json, die kein gültiges JSON ist. Von hier lässt er sich nicht entfernen - das kann nur, wer den Ablageort pflegt.'
        default:
            return 'Diese Version liegt nicht (mehr) im Ablageort, und bei GitLab ist für sie nichts offen - es gibt nichts zurückzuziehen.'
    }
}

/** The newest merge whose base did not already hold this version, and the commit before it. */
async function mergeThatBrought(
    client: GitLabClient,
    projectId: number,
    merges: MergeRequestRef[],
    dir: string,
    version: string,
): Promise<{ mr: MergeRequestRef; before: string; version?: string } | undefined> {
    let found: { mr: MergeRequestRef; before: string; version?: string } | undefined
    for (const mr of merges) {
        const before = await commitBefore(client, projectId, mr)
        if (!before) continue
        found = { mr, before, version: versionIn(await readFile(client, projectId, `${dir}/core-ir/manifest.json`, before)) }
        if (found.version !== version) return found
    }
    return found
}

/** Closes only the bot's own requests; with a choice, the other scope's plan is `alternative`. */
export async function readDeletion(
    config: ExportConfig,
    target: ExportTarget,
    token: string,
    slug: string,
    version: string,
    /** As `proposerName` gives it. */
    requestedBy: string,
    scope: DeletionScope = 'proposal',
): Promise<{ plan: DeletionPlan; work: DeletionWork; alternative?: DeletionPlan }> {
    const client: GitLabClient = { ...clientFor(target.url, token), cache: SHARE_READS }
    const project = await getProject(client, parseProjectUrl(target.url).projectPath)
    const [bot, requests, removals] = await Promise.all([
        currentUser(client),
        findMergeRequests(client, project.id, bundleBranch(slug, version)),
        findMergeRequests(client, project.id, removalBranch(slug, version)),
    ])
    const ours = (mr: MergeRequestRef) => mr.author?.id === bot.id
    const proposedBy = proposerOf(requests.find(ours)?.description)
    const byOther = proposedByOther(proposedBy, requestedBy)

    const closes: DeletionWork['closes'] = []
    const shown = () => closes.map((step) => ({ what: step.what, ref: ref(step.mr), url: step.mr.web_url }))
    const planned = (plan: Omit<DeletionPlan, 'fingerprint' | 'proposedBy' | 'byOther'>, work: DeletionWork = { closes }, detail: unknown = null) => {
        const named = { ...plan, ...(proposedBy ? { proposedBy } : {}) }
        // Not `byOther`: the plan is the same for everyone who asks.
        return { plan: { ...named, ...(byOther ? { byOther } : {}), fingerprint: fingerprintOf(named, detail) }, work }
    }
    const nothing = (reason: string, mrUrl?: string) => planned({ kind: 'none', closes: [], reason, ...(mrUrl ? { mrUrl } : {}) }, { closes: [] })
    const withdrawOnly = (stays: Pick<DeletionPlan, 'listed' | 'takenOut' | 'accepted'> = {}) => planned({ kind: 'withdraw', closes: shown(), ...stays })

    const open = requests.find((mr) => mr.state === 'opened')
    if (open && !ours(open)) {
        return nothing(`Der offene Vorschlag ${ref(open)} kam nicht über diesen Marktplatz - zurückziehen kann ihn nur, wer ihn geöffnet hat.`, open.web_url)
    }
    if (open) closes.push({ client, projectId: project.id, mr: open, what: 'bundle' })

    const pendingRemoval = removals.find((mr) => mr.state === 'opened')
    if (pendingRemoval) {
        if (closes.length) return withdrawOnly()
        return nothing(`Das Entfernen ist schon vorgeschlagen (${ref(pendingRemoval)}) - jetzt entscheidet das Katalog-Team.`, pendingRemoval.web_url)
    }

    const head = await branchHead(client, project.id, target.baseBranch)
    const dir = packageDir(target, slug)
    const { status: bundle } = await inspectBundleIn(client, target, slug, version, undefined, {
        projectId: project.id,
        requests: requests.filter((mr) => mr.state !== 'opened'),
        head,
        treeOnBase: () => Promise.resolve(undefined),
        verify: false,
    })
    if (bundle.state !== 'on-base' || !head) return closes.length ? withdrawOnly() : nothing(notThere(bundle))

    if (config.catalog) {
        const catalog = await readCatalogSide(config.catalog, token, slug, version, bundle.packageId, { client, project })
        const foreign = catalog.opened.find((mr) => !ours(mr))
        if (foreign) {
            return nothing(
                `Für diese Version ist der Katalog-Vorschlag ${ref(foreign)} offen, und er kam nicht über diesen Marktplatz - zurückziehen kann ihn nur, wer ihn geöffnet hat.`,
                foreign.web_url,
            )
        }
        // Matches the pin sentence `proposeCatalog` writes: the catalogue's branch names no repository.
        const pin = ` of ${target.url} (path \`${dir}\`)`
        const proposal = catalog.opened.find((mr) => mr.description?.includes(pin))
        if (proposal) closes.push({ client: catalog.client, projectId: catalog.projectId, mr: proposal, what: 'catalog' })
        if (catalog.listed) {
            if (closes.length) return withdrawOnly({ listed: true })
            return nothing(`Version ${version} steht im Katalog. Herausnehmen kann sie nur das Katalog-Team, als zurückgezogenen Eintrag - gelöscht wird im Katalog nichts.`)
        }
        if (catalog.takenOut) {
            if (closes.length) return withdrawOnly({ takenOut: true })
            return nothing(`Das Katalog-Team hat Version ${version} aus dem Katalog genommen, und offen ist dazu nichts mehr. Das angenommene Paket bleibt, wie es ist.`)
        }
    }

    // A turned-down removal is never proposed again, even where its comments cannot be read.
    const declinedRemoval = await readDecline(client, project.id, presentRequests(removals, requests), async () => bot, 'tell')
    if (declinedRemoval) {
        if (closes.length) return withdrawOnly({ accepted: true })
        return nothing(removalRefusal(declinedRemoval), declinedRemoval.mrUrl)
    }

    // Undoing the merge, not deleting the folder: a replaced older version gets the folder back.
    const merge = await mergeThatBrought(client, project.id, requests.filter((mr) => mr.state === 'merged' && ours(mr)), dir, version)
    if (!merge) {
        if (closes.length) return withdrawOnly({ accepted: true })
        return nothing('Das Paket kam nicht über einen Vorschlag dieses Marktplatzes in den Ablageort - entfernen kann es dort nur, wer den Ablageort pflegt.')
    }
    const [now, then] = await Promise.all([listBlobs(client, project.id, dir, head), listBlobs(client, project.id, dir, merge.before)])
    const deleted = [...now.keys()].filter((path) => !then.has(path)).sort()
    const written = [...then].filter(([path, id]) => now.get(path) !== id).map(([path]) => path).sort()
    if (deleted.length === 0 && written.length === 0) {
        return closes.length ? withdrawOnly({ accepted: true }) : nothing('Im Ablageort ist für diese Version nichts zu entfernen.')
    }
    const choice = closes.length > 0
    const removing = planned(
        {
            kind: 'remove',
            closes: shown(),
            ...(choice ? { scope: 'version' as const } : {}),
            removal: {
                folder: dir,
                previous: then.size > 0,
                ...(then.size > 0 && merge.version ? { restores: merge.version } : {}),
                files: deleted.length + written.length,
                mergedUrl: merge.mr.web_url,
            },
        },
        {
            closes,
            removal: {
                client,
                project,
                target,
                slug,
                version,
                displayName: displayNameOf(merge.mr.title, version) ?? slug,
                before: merge.before,
                written,
                deleted,
                existing: new Set(now.keys()),
                catalogueChecked: Boolean(config.catalog),
                ...datasetOf(requests.filter(ours)),
            },
        },
        // Any change to the folder since makes it another plan.
        { before: merge.before, changes: [...deleted, ...written].map((path) => `${path}:${now.get(path) ?? '-'}>${then.get(path) ?? '-'}`) },
    )
    if (!choice) return removing
    const keeping = planned({ kind: 'withdraw', closes: shown(), accepted: true, scope: 'proposal' })
    return scope === 'version' ? { ...removing, alternative: keeping.plan } : { ...keeping, alternative: removing.plan }
}

function datasetOf(requests: MergeRequestRef[]): { datasetId?: string } {
    const datasetId = requests.map((mr) => shareSourceOf(mr.description)?.id).find(Boolean)
    return datasetId ? { datasetId } : {}
}

function withdrawalNote(what: 'bundle' | 'catalog', plan: DeletionPlan, requestedBy: string): string {
    const who = `Withdrawn through the Open Urban Apps marketplace on behalf of **${requestedBy}**.`
    if (plan.kind === 'remove') return `${who} The version's merged package is proposed for removal from the repository as well.`
    if (plan.listed) return `${who} The listed version stays as it is.`
    if (plan.accepted) return `${who} The merged package stays in the repository as it is.`
    if (plan.takenOut && what === 'catalog') {
        return `${who} The catalogue team took this version out of the catalogue; this proposal would have brought it back. The package stays in the repository as it is.`
    }
    if (what === 'catalog') return `${who} The package stays in the repository as it is.`
    return `${who} Sharing the use case again opens a new merge request.`
}

function removalBody(removal: NonNullable<DeletionWork['removal']>, plan: DeletionPlan, requestedBy: string): string {
    const facts = plan.removal as NonNullable<DeletionPlan['removal']>
    const files = `${facts.files} ${facts.files === 1 ? 'file' : 'files'}`
    const listing = removal.catalogueChecked
        ? 'and is not listed in the catalogue'
        : 'and no catalogue is configured for this marketplace, so whether one lists it is not known'
    return [
        `Proposed by the Open Urban Apps marketplace on behalf of **${requestedBy}**.`,
        '',
        `## Remove ${removal.displayName} ${removal.version}`,
        '',
        `${requestedBy} withdrew this shared version in the marketplace. It came in with ${facts.mergedUrl} ${listing}.` +
            (plan.closes.length ? ` Withdrawn with it: ${plan.closes.map((close) => close.url).join(', ')}.` : ''),
        '',
        facts.previous
            ? `- sets \`${facts.folder}/\` back to ${facts.restores ? `version ${facts.restores}` : 'its state'} from before that merge (${files})`
            : `- removes \`${facts.folder}/\` (${files})`,
        '',
        'Nothing installed from the catalogue changes: an entry pins a commit, and the commit stays in the history.',
        '',
        '---',
        `Branch \`${removalBranch(removal.slug, removal.version)}\` · proposed via "Zurückziehen" in the marketplace's "In Arbeit"`,
        '',
        shareSourceLine({ kind: 'dataset', id: removal.datasetId, instance: thisInstance() }),
    ].join('\n')
}

function closedSentence(closed: string[]): string {
    return closed.length === 1 ? `Vorschlag ${closed[0]} ist geschlossen` : `Die Vorschläge ${closed.join(' und ')} sind geschlossen`
}

/** Reads, then closes, then removes; a failure after a close is `partial`: the close stays. */
export async function runDeletion(
    plan: DeletionPlan,
    work: DeletionWork,
    requestedBy: string,
    explain: (error: GitLabError) => string,
): Promise<DeletionResult> {
    if (plan.kind === 'none') return { status: 'unchanged', detail: plan.reason ?? 'Hier gibt es nichts zurückzuziehen.' }
    const removal = plan.kind === 'remove' ? work.removal : undefined

    // Read before anything changes, so an unreadable file changes nothing.
    const files = removal
        ? Object.fromEntries(
              await Promise.all(
                  removal.written.map(async (path) => {
                      const content = await readFile(removal.client, removal.project.id, path, removal.before)
                      if (content === undefined) throw new GitLabError(`${path} ist im Stand vor der Annahme nicht lesbar`, 404)
                      return [path, content] as const
                  }),
              ),
          )
        : {}

    const closed: string[] = []
    try {
        for (const step of work.closes) {
            await withdrawMergeRequest(step.client, step.projectId, step.mr, {
                note: withdrawalNote(step.what, plan, requestedBy),
                mark: withdrawalMark(requestedBy, new Date()),
            })
            closed.push(ref(step.mr))
        }
        if (!removal) {
            const stays = plan.listed
                ? 'Die Version bleibt im Katalog, wie sie ist.'
                : plan.accepted || plan.takenOut
                  ? 'Das angenommene Paket bleibt, wie es ist.'
                  : undefined
            return {
                status: 'ok',
                detail: stays ? `${closedSentence(closed)}. ${stays}` : `${closedSentence(closed)} - das Teilen ist zurückgezogen.`,
                mrUrl: plan.closes.at(-1)?.url,
            }
        }

        const outcome = await openMergeRequest(removal.client, {
            upstream: removal.project,
            baseBranch: removal.target.baseBranch,
            branch: removalBranch(removal.slug, removal.version),
            title: `Remove use case: ${removal.displayName} ${removal.version}`,
            description: removalBody(removal, plan, requestedBy),
            files,
            existingPaths: removal.existing,
            deletedPaths: removal.deleted,
        })
        const mrRef = mergeRequestRef(outcome.url) ?? `!${outcome.iid}`
        const proposed =
            outcome.status === 'already-open'
                ? `Das Entfernen ist schon vorgeschlagen (${mrRef}).`
                : `Entfernen vorgeschlagen: Vorschlag ${mrRef} wartet auf das Katalog-Team.`
        return { status: 'ok', detail: closed.length ? `${proposed} ${closedSentence(closed)}.` : proposed, mrUrl: outcome.url }
    } catch (error) {
        if (!(error instanceof GitLabError) || closed.length === 0) throw error
        return { status: 'error', detail: `${closedSentence(closed)}. Danach ging es nicht weiter: ${explain(error)}`, partial: true }
    }
}
