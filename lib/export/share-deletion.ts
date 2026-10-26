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

/**
 * What "Zurückziehen" in "In Arbeit" does to one shared version, by how far it
 * got (Ewa, 2026-10-17: "completely delete a process of sharing - decide what
 * that means on each stage"; the button was "Löschen" until rc.5):
 *
 * - whatever is still proposed is withdrawn: the package's merge request and
 *   the catalogue proposal, each closed, with a note and without its branch.
 *   GitLab keeps a closed request as its record.
 * - merged: the catalogue team took the package in, so taking it out is
 *   theirs to decide too. A merge request proposes it: the package folder goes
 *   back to how it was before the merge that brought the version in, which
 *   removes it for a first version.
 * - merged with a proposal still open (a change to the accepted package, or
 *   its catalogue entry): the person chooses (decided 2026-10-18). The
 *   default, scope `proposal`, withdraws only what is open and leaves the
 *   accepted package; scope `version` also proposes its removal. Both plans
 *   are read at once, so the dialog can switch between them without asking
 *   GitLab again.
 * - listed: never deleted from here. The catalogue withdraws entries as
 *   tombstones (`revoked`), and that is a curation decision; only what is
 *   still proposed is withdrawn. The same holds for a version the catalogue
 *   team took out again (see `takenOutIn`): it was in the catalogue, and a
 *   proposal that would bring it back is all there is to withdraw.
 * - its removal turned down by the catalogue team: never proposed again from
 *   here - only the team lifts their "no", by reopening. What is still open
 *   is withdrawn as before.
 *
 * The marketplace still only proposes, and takes back what it proposed: no
 * code path merges, and no code path deletes on a branch anyone reviews.
 *
 * Read and run in two steps, because the person confirms what they were
 * shown: `readDeletion` names the plan with a fingerprint, and the action
 * runs only while a fresh reading yields the same one.
 */

/**
 * - `withdraw`: only proposals are closed - nothing of the version is merged, it is listed and stays, or the person chose to keep it.
 * - `remove`: the version is merged and not listed; its removal is proposed, after closing what is still open.
 * - `none`: nothing to withdraw from here; `reason` says why.
 */
export type DeletionKind = 'withdraw' | 'remove' | 'none'

/**
 * What a withdrawal covers where there is a choice, a merged version with a
 * proposal still open: only that proposal (`proposal`, the default and the
 * least destructive), or the accepted package as well (`version`).
 */
export type DeletionScope = 'proposal' | 'version'

export const DELETION_SCOPES: readonly DeletionScope[] = ['proposal', 'version']

export interface DeletionPlan {
    kind: DeletionKind
    /** The merge requests the deletion closes, in this order: the package's, then the catalogue's. */
    closes: { what: 'bundle' | 'catalog'; ref: string; url: string }[]
    /** For `withdraw`: the version is in the catalogue, and stays there. */
    listed?: boolean
    /** For `withdraw`: the catalogue team took the version out; what is open would bring it back, and the package stays. */
    takenOut?: boolean
    /** For `withdraw` of scope `proposal`: the package is accepted, and stays as it is. */
    accepted?: boolean
    /** Set where the person chooses between two plans: which of them this is. Part of the fingerprint. */
    scope?: DeletionScope
    /** For `remove`: the folder, whether something was there before the merge (and which version), how many files change. */
    removal?: { folder: string; previous: boolean; restores?: string; files: number; mergedUrl: string }
    /** For `none`: why nothing is withdrawn from here. */
    reason?: string
    /** For `none`: the merge request that is already in the way, or already on it. */
    mrUrl?: string
    /** Whom the version was proposed for, as its merge request names them. */
    proposedBy?: string
    /** Proposed for someone else than the person asking, who should know before withdrawing it. */
    byOther?: boolean
    /** Names exactly this plan, see above. */
    fingerprint: string
}

export interface DeletionResult {
    status: 'ok' | 'changed' | 'unchanged' | 'error' | 'forbidden' | 'unconfigured' | 'invalid'
    detail: string
    /** The merge request the deletion closed or opened, to look at. */
    mrUrl?: string
    /** The plan as it is now, when it is no longer the confirmed one. */
    plan?: DeletionPlan
    /** With `plan`: the other plan of a choice, when there still is one. */
    alternative?: DeletionPlan
    /** It failed after closing something: GitLab changed all the same. */
    partial?: boolean
}

/** What running a plan needs beyond what the person is shown. */
export interface DeletionWork {
    closes: { client: GitLabClient; projectId: number; mr: MergeRequestRef; what: 'bundle' | 'catalog' }[]
    removal?: {
        client: GitLabClient
        project: GitLabProject
        target: ExportTarget
        slug: string
        version: string
        displayName: string
        /** The base branch just before the merge that brought the version in: what the folder goes back to. */
        before: string
        written: string[]
        deleted: string[]
        existing: Set<string>
        /** Whether a catalogue was there to ask: without one, nobody knows whether the version is listed somewhere. */
        catalogueChecked: boolean
        /** The dataset the version was shared from, as its proposals name it; undefined for older shares. */
        datasetId?: string
    }
}

const ref = (mr: MergeRequestRef) => mergeRequestRef(mr.web_url) ?? `!${mr.iid}`

/** "1 Datei", "3 Dateien". */
export function fileCount(count: number): string {
    return `${count} ${count === 1 ? 'Datei' : 'Dateien'}`
}

function fingerprintOf(plan: Omit<DeletionPlan, 'fingerprint' | 'byOther'>, detail: unknown): string {
    // What the dialog words differently is part of it: the person confirmed those words, not only the closes.
    const words = [plan.scope ?? '', Boolean(plan.listed), Boolean(plan.takenOut), Boolean(plan.accepted)]
    return createHash('sha256').update(JSON.stringify([plan.kind, plan.closes.map((close) => close.url), plan.reason ?? '', ...words, detail])).digest('hex').slice(0, 32)
}

/**
 * The catalogue's side of one version: the proposals open for it, and whether
 * its index lists it. Often the same repository as the target, whose project
 * is known then already.
 */
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
    // Exactly this version was in the catalogue: a withdrawn entry of another version leaves this one the repository's to remove.
    const out = packageId ? takenOutIn({ openRequests: opened, index, merged }, packageId, version) : undefined
    return {
        client,
        projectId: project.id,
        opened,
        listed: Boolean(index && packageId && isListed(index, packageId, version)),
        takenOut: Boolean(out?.thisVersion && out.version === version),
    }
}

/** A manifest's version, or undefined when there is none to read. */
function versionIn(manifestRaw: string | undefined): string | undefined {
    try {
        const version = manifestRaw ? (JSON.parse(manifestRaw) as { version?: unknown }).version : undefined
        return typeof version === 'string' ? version : undefined
    } catch {
        return undefined
    }
}

/** Why a version that is not on the base branch has nothing to withdraw, in the person's words. */
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

/**
 * The merge that brought the version in, and the base branch just before it:
 * the newest merge by the bot whose base did not hold the version already.
 * A version merged twice (before the export refused that) goes back to
 * before the first; a version shared again after a newer one had replaced it
 * goes back to that newer one, not to before the first share.
 */
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

/**
 * What withdrawing one version means now, read fresh from GitLab. Only the
 * bot's own merge requests are ever closed. `scope` picks the plan where the
 * person has a choice; the other one comes along as `alternative`. Where there
 * is none, the one plan there is answers either scope - its fingerprint says
 * which it is.
 */
export async function readDeletion(
    config: ExportConfig,
    target: ExportTarget,
    token: string,
    slug: string,
    version: string,
    /** Who asks, by the name proposals are made for (`proposerName`). */
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
        // Who asks is no part of the fingerprint: the plan is the same for everyone.
        return { plan: { ...named, ...(byOther ? { byOther } : {}), fingerprint: fingerprintOf(named, detail) }, work }
    }
    const nothing = (reason: string, mrUrl?: string) => planned({ kind: 'none', closes: [], reason, ...(mrUrl ? { mrUrl } : {}) }, { closes: [] })
    // What is still proposed goes in any case; nothing else, when the rest is not the marketplace's to undo.
    // The flags say what stays, so the dialog and the note on GitLab say it too.
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

    // What is merged of the version, apart from the proposal that is being withdrawn.
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
        // The catalogue's branch names no repository: only a proposal that pins this one belongs to this share.
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

    // The catalogue team said no to taking it out: the package stays accepted, whatever is open still goes.
    // Counted since it was last accepted, and told even where its comments cannot be read: the marketplace never withdraws a removal.
    const declinedRemoval = await readDecline(client, project.id, presentRequests(removals, requests), async () => bot, 'tell')
    if (declinedRemoval) {
        if (closes.length) return withdrawOnly({ accepted: true })
        return nothing(removalRefusal(declinedRemoval), declinedRemoval.mrUrl)
    }

    // Undoing the merge, not deleting a folder: a version that replaced an older one hands the folder back to it.
    const merge = await mergeThatBrought(client, project.id, requests.filter((mr) => mr.state === 'merged' && ours(mr)), dir, version)
    // From here on the package is accepted: what is open is withdrawn, and the package stays unless the person chooses otherwise.
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
    // A proposal still open on the accepted package: withdrawing only it, or the package too, is the person's choice.
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
                // From the proposals only: the README of an older share is not read for a line nobody shows.
                ...datasetOf(requests.filter(ours)),
            },
        },
        // Any change to the folder since, on the base branch or before the merge, makes it another plan.
        { before: merge.before, changes: [...deleted, ...written].map((path) => `${path}:${now.get(path) ?? '-'}>${then.get(path) ?? '-'}`) },
    )
    if (!choice) return removing
    const keeping = planned({ kind: 'withdraw', closes: shown(), accepted: true, scope: 'proposal' })
    return scope === 'version' ? { ...removing, alternative: keeping.plan } : { ...keeping, alternative: removing.plan }
}

/** The dataset the newest of `requests` that names one was shared from. */
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

/** "Vorschlag !26 ist geschlossen", "Die Vorschläge !21 und !20 sind geschlossen". */
function closedSentence(closed: string[]): string {
    return closed.length === 1 ? `Vorschlag ${closed[0]} ist geschlossen` : `Die Vorschläge ${closed.join(' und ')} sind geschlossen`
}

/**
 * Runs a plan `readDeletion` just named: whatever is only read comes first,
 * then the closes, then the removal. A failure after a close says what
 * already happened (`partial`), since a close is not undone by the error
 * that follows it.
 */
export async function runDeletion(
    plan: DeletionPlan,
    work: DeletionWork,
    requestedBy: string,
    explain: (error: GitLabError) => string,
): Promise<DeletionResult> {
    if (plan.kind === 'none') return { status: 'unchanged', detail: plan.reason ?? 'Hier gibt es nichts zurückzuziehen.' }
    const removal = plan.kind === 'remove' ? work.removal : undefined

    // The files the folder goes back to, read before anything changes: an unreadable one changes nothing.
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
            // The mark goes with the close: without it, the listing would read the close as the catalogue team's "no".
            await withdrawMergeRequest(step.client, step.projectId, step.mr, {
                note: withdrawalNote(step.what, plan, requestedBy),
                mark: withdrawalMark(requestedBy, new Date()),
            })
            closed.push(ref(step.mr))
        }
        if (!removal) {
            // A version taken out of the catalogue was accepted before, and its package stays as well.
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
