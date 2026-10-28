import { catalogInputFromManifest } from '@/lib/export/catalog-entry'
import { parseBundleBranch, parseCatalogBranch, parseRemovalBranch } from '@/lib/export/config'
import { declinedBy, declinedProposal, declineOf, mayBeWithdrawn, sinceStart, startedOver, type Decline } from '@/lib/export/declines'
import type { MergeRequestRef } from '@/lib/export/gitlab'
import { inProgressHref, mayProposeEntry } from '@/lib/export/in-progress-items'
import type { ExportMetadata } from '@/lib/export/metadata'
import { shareSourceOf, withdrawalMarkIn } from '@/lib/export/merge-request-text'
import { slugify } from '@/lib/export/names'
import type { ShareProposal, SharedPackageRow } from '@/lib/export/share-listing'
import { higherFirst, lastDecided, sameVersionAgain, sharedPackageOf, usedVersions, type SharedPackage } from '@/lib/export/shared-package'
import { aboveAll, isNewerVersion, nextPatch, STAGES, takenOutNotice } from '@/lib/export/share-stages'
import { instanceMatch, OPEN_OUTCOMES, type ShareOutcome, type TabRow } from '@/lib/export/share-tabs'
import type { ExportSource } from '@/lib/export/sources'
import { catalogEntryPath } from '@/lib/use-case-catalog/path'

// Kept in `shared-package.ts`, so „Beendet“ loads them without this module's catalogue and form code.
export { sameVersionAgain, sharedPackageOf, usedVersions, type PackageMatch, type SharedPackage, type VersionFact } from '@/lib/export/shared-package'

export function suggestedVersion(pkg: SharedPackage | undefined, also: readonly string[] = []): string {
    return aboveAll([...(pkg ? usedVersions(pkg) : []), ...also])
}

/** The highest proposed version, whatever became of it: its text is the newest. */
export function fillVersionOf(pkg: SharedPackage | undefined): string | undefined {
    return pkg?.versions.find((fact) => fact.outcome !== 'unreadable')?.version
}

export interface FollowedDecline {
    version: string
    kind: 'package' | 'entry'
    decline: Decline
}

/** Outcomes whose entry may be what was turned down, also after a "no" to its removal or once gone. */
const ENTRY_NO_OUTCOMES: ReadonlySet<ShareOutcome> = new Set(['entry-declined', 'removal-declined', 'removed', 'gone'])

const originOf = (proposal: ShareProposal | undefined, row: SharedPackageRow) => (proposal?.source?.instance ? proposal.source : row.source)

/** Other instances' versions are passed over: they share one account, and their people answer their "no". */
export function followedDecline(pkg: SharedPackage | undefined, instance?: string): FollowedDecline | undefined {
    const last = lastDecided(pkg, (fact) => instanceMatch(fact.row.source, instance) === 'other')
    if (!last) return undefined
    const proposals = last.row.proposals ?? []
    if (last.outcome === 'declined') {
        const turnedDown = declinedProposal(proposals, 'bundle')
        if (!turnedDown || mayBeWithdrawn(turnedDown) || instanceMatch(originOf(turnedDown, last.row), instance) === 'other') return undefined
        return { version: last.version, kind: 'package', decline: declineOf(turnedDown) }
    }
    if (!ENTRY_NO_OUTCOMES.has(last.outcome)) return undefined
    const turnedDown = declinedProposal(proposals, 'catalog')
    if (turnedDown && mayBeWithdrawn(turnedDown)) return undefined
    // While the entry is in the repository, the catalogue's reading decides; once gone, its proposals do.
    const entry = last.row.catalog ? (last.row.catalog.state === 'declined' ? last.row.catalog.declined : undefined) : turnedDown && declineOf(turnedDown)
    if (!entry || instanceMatch(originOf(turnedDown, last.row), instance) === 'other') return undefined
    return { version: last.version, kind: 'entry', decline: entry }
}

export function declineIsNews(
    rows: readonly SharedPackageRow[] | undefined,
    answer: { bundle?: { declined?: Pick<Decline, 'mrUrl'> }; catalog?: { state: string; declined?: Pick<Decline, 'mrUrl'> }; follows?: { decline: Pick<Decline, 'mrUrl'> } },
): boolean {
    const told = [answer.bundle?.declined, answer.catalog?.state === 'declined' ? answer.catalog.declined : undefined, answer.follows?.decline].filter(
        (decline): decline is Pick<Decline, 'mrUrl'> => Boolean(decline),
    )
    const known = (url: string) => rows?.some((row) => row.proposals?.some((proposal) => proposal.url === url && proposal.state === 'closed'))
    return told.some((decline) => !known(decline.mrUrl))
}

/** Asked only above the turned-down version; a lower or equal one is refused anyway. */
export function asksWhatChanged(followed: FollowedDecline | undefined, version: string): followed is FollowedDecline {
    return Boolean(followed && isNewerVersion(version.trim(), followed.version))
}

export function followedFact(followed: FollowedDecline): string {
    if (followed.kind === 'package') return `Version ${followed.version} ${declinedBy(followed.decline)}`
    return `${followed.decline.viaMarketplace ? 'Der' : 'Den'} Katalog-Eintrag für Version ${followed.version} ${declinedBy(followed.decline)}`
}

/** The change note stands in one line of the new proposal. */
export const CHANGE_NOTE_MAX = 500

export interface FollowsRef {
    iid: number
    url: string
    closedAt?: string
}

export function followsRefOf(followed: FollowedDecline): FollowsRef {
    return { iid: followed.decline.iid, url: followed.decline.mrUrl, ...(followed.decline.closedAt ? { closedAt: followed.decline.closedAt } : {}) }
}

/** Undefined for none, null for a malformed one; whose project the URL names, the server checks. */
export function parseFollows(raw: string): FollowsRef | undefined | null {
    if (!raw.trim()) return undefined
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return null
    }
    if (!parsed || typeof parsed !== 'object') return null
    const { iid, url, closedAt } = parsed as Record<string, unknown>
    if (typeof iid !== 'number' || !Number.isInteger(iid) || iid <= 0) return null
    const named = typeof url === 'string' ? url.match(/^https?:\/\/\S+\/-\/merge_requests\/(\d+)$/)?.[1] : undefined
    if (typeof url !== 'string' || Number(named) !== iid) return null
    const closed = typeof closedAt === 'string' && !Number.isNaN(Date.parse(closedAt)) ? { closedAt } : {}
    return { iid, url, ...closed }
}

export function changeNoteProblem(note: string): string | undefined {
    const length = Array.from(note.trim()).length
    if (length === 0) return 'Was hast du geändert? Bitte kurz beschreiben - das Katalog-Team liest es im neuen Vorschlag.'
    if (length > CHANGE_NOTE_MAX) return `Was hast du geändert? Bitte höchstens ${CHANGE_NOTE_MAX} Zeichen.`
    return undefined
}

const ISO_DAY = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Berlin' })

// One line, brackets escaped: the note must not pass for a line read back (source line, withdrawal mark).
// Linked, as the proposal followed may be in another repository than „!N“ points into.
export function followsLine(ref: FollowsRef, note: string, by: string): string {
    const closed = ref.closedAt ? Date.parse(ref.closedAt) : NaN
    const when = Number.isNaN(closed) ? 'not accepted' : `not accepted on ${ISO_DAY.format(closed)}`
    const words = note.replace(/\s+/g, ' ').trim().replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const who = by && by !== 'unbekannt' ? `${by}'s` : "the sharer's"
    return `Follows [!${ref.iid}](${ref.url}) (${when}). What changed, in ${who} words: "${words}"`
}

export interface ListingFacts {
    rows: readonly SharedPackageRow[]
    busy: ReadonlyMap<string, TabRow[]>
    instance?: string
}

export interface Opening {
    from?: { version: string; slug?: string }
    started?: boolean
}

/** By `from` at its version or higher: after a "no" above an accepted version it leads on from both. */
const namedBy = (tabbed: TabRow, from: Opening['from']) =>
    Boolean(from && (!from.slug || tabbed.row.slug === from.slug) && !isNewerVersion(tabbed.row.version, from.version))

export function blockingRows(busy: readonly TabRow[] | undefined, opening: Opening = {}): TabRow[] {
    return (busy ?? []).filter((tabbed) => OPEN_OUTCOMES.has(tabbed.outcome) || !(opening.started || namedBy(tabbed, opening.from)))
}

export type DatasetStage =
    | { kind: 'busy'; rows: TabRow[] }
    | { kind: 'declined'; followed: FollowedDecline }
    | { kind: 'taken-out'; takenOut: { version: string; reason?: string }; whole: boolean }
    | { kind: 'listed'; version: string; name: string }
    | { kind: 'name-taken'; slug: string; pkg: SharedPackage }
    | { kind: 'none' }

export function defaultSlugOf(source: Pick<ExportSource, 'name' | 'catalog'>): string {
    return source.catalog ? catalogEntryPath(source.catalog.id).slug : slugify(source.name)
}

export function packageOfSource(source: Pick<ExportSource, 'id' | 'name' | 'catalog'>, listing: Pick<ListingFacts, 'rows' | 'instance'>): SharedPackage | undefined {
    return sharedPackageOf(listing.rows, { datasetId: source.id, slug: defaultSlugOf(source), anyInstance: Boolean(source.catalog) }, listing.instance)
}

export function datasetStage(source: Pick<ExportSource, 'id' | 'name' | 'catalog'>, listing: ListingFacts, opening: Opening = {}): DatasetStage {
    const blocking = blockingRows(listing.busy.get(source.id), opening)
    if (blocking.length) return { kind: 'busy', rows: blocking }
    const pkg = packageOfSource(source, listing)
    const followed = followedDecline(pkg, listing.instance)
    if (followed) return { kind: 'declined', followed }
    // Any instance's version counts: the catalogue holds one entry per package.
    const last = lastDecided(pkg)
    const takenOut = last && (last.outcome === 'taken-out' || last.outcome === 'entry-revoked') ? last.row.catalog?.takenOut : undefined
    if (takenOut) return { kind: 'taken-out', takenOut, whole: last?.outcome === 'entry-revoked' }
    const listed = pkg?.versions.find((fact) => fact.outcome === 'listed')
    if (listed) return { kind: 'listed', version: listed.version, name: listed.row.displayName }
    // Installed from the catalogue: sharing it is a new version of that entry.
    if (source.catalog) return { kind: 'listed', version: source.catalog.version, name: source.catalog.displayName }
    const slug = defaultSlugOf(source)
    const taken = pkg ? undefined : nameTakenIn(listing.rows, slug, listing.instance)
    if (taken) return { kind: 'name-taken', slug, pkg: taken }
    return { kind: 'none' }
}

/** Only other instances shared under `slug`; a version naming no instance counts as this one's. */
export function nameTakenIn(rows: readonly SharedPackageRow[], slug: string, instance: string | undefined, targetKey?: string): SharedPackage | undefined {
    const pkg = sharedPackageOf(rows, { slug, anyInstance: true, ...(targetKey ? { targetKey } : {}) }, instance)
    return pkg?.versions.every((fact) => instanceMatch(fact.row.source, instance) === 'other') ? pkg : undefined
}

export function versionsOf(rows: readonly TabRow[]): string {
    return [...new Set(rows.map((tabbed) => tabbed.row.version))].sort((a, b) => -higherFirst({ version: a }, { version: b })).join(', ')
}

export function stageHint(stage: DatasetStage): string | undefined {
    switch (stage.kind) {
        case 'busy':
            return `In Arbeit (${versionsOf(stage.rows)}) - nicht wählbar`
        case 'declined':
            return stage.followed.kind === 'entry'
                ? `Katalog-Eintrag für ${stage.followed.version} nicht angenommen - du teilst eine neue Version`
                : `Version ${stage.followed.version} nicht angenommen - du teilst eine neue Version`
        case 'taken-out':
            return stage.whole
                ? 'Ganzer Eintrag aus dem Katalog genommen - nur das Katalog-Team kann ihn wieder freigeben'
                : `Version ${stage.takenOut.version} aus dem Katalog genommen - du teilst eine neue Version`
        case 'listed':
            return `Im Katalog als ${stage.version} - du teilst eine neue Version`
        default:
            return undefined
    }
}

function busyStage(tabbed: TabRow): string {
    if (tabbed.outcome === 'removal-pending') return 'Entfernen'
    return STAGES.find((stage) => stage.key === tabbed.progress.active)?.short ?? STAGES[2].short
}

export interface StageNotice {
    text: string
    link?: { label: string; href: string }
}

function nextOnRow(tabbed: TabRow): string {
    if (tabbed.outcome === 'accepted' || (tabbed.outcome === 'removal-declined' && mayProposeEntry(tabbed.row))) {
        return 'Unter „In Arbeit“ schlägst du den Katalog-Eintrag vor oder teilst eine neue Version.'
    }
    return tabbed.outcome === 'removal-declined' ? 'Unter „In Arbeit“ teilst du eine neue Version.' : 'Unter „In Arbeit“ steht, was als Nächstes geht.'
}

/** Busy is reached only through a link or a race, so it links on rather than offering a button. */
export function stageNotice(stage: DatasetStage, datasetName: string): StageNotice | undefined {
    switch (stage.kind) {
        case 'busy': {
            const open = stage.rows.find((tabbed) => OPEN_OUTCOMES.has(tabbed.outcome))
            const shown = open ?? stage.rows[0]
            const link = { label: 'Zu „In Arbeit“', href: inProgressHref(shown.row) }
            if (open) return { text: `Für „${datasetName}“ läuft schon ein Vorschlag (Version ${open.row.version}, ${busyStage(open)}).`, link }
            return { text: `Für „${datasetName}“ ist Version ${shown.row.version} angenommen, steht aber noch nicht im Katalog. ${nextOnRow(shown)}`, link }
        }
        case 'listed':
            return { text: `„${stage.name}“ steht schon im Katalog (Version ${stage.version}). Du teilst eine neue Version - die bisherige bleibt im Katalog, bis das Katalog-Team die neue aufnimmt.` }
        case 'declined':
            return { text: `${followedFact(stage.followed)}. Du teilst eine neue Version - im Steckbrief schreibst du dazu, was du geändert hast.` }
        case 'taken-out': {
            if (!stage.whole) return { text: takenOutNotice(stage.takenOut) }
            const reason = stage.takenOut.reason ? ` Grund: ${sentenceOf(stage.takenOut.reason)}` : ''
            return {
                text:
                    `Das Katalog-Team hat den ganzen Eintrag aus dem Katalog genommen (zuletzt Version ${stage.takenOut.version}).${reason} ` +
                    'Auch eine neue Version kommt erst in den Katalog, wenn das Katalog-Team den Eintrag wieder freigibt.',
            }
        }
        case 'name-taken':
            return {
                text:
                    `Unter dem Kurznamen „${stage.slug}“ hat schon eine andere Instanz ein Paket geteilt. ` +
                    'Wähl im Steckbrief unter „Adresse ändern“ einen eigenen Kurznamen - sonst wird dein Paket eine neue Version davon.',
            }
        default:
            return undefined
    }
}

/** Open proposals beside the form's own version, which once submitted is its own proposal in review. */
export function busyBeside(rows: readonly TabRow[], form: { targetKey: string; slug: string; version: string }): TabRow[] {
    const slug = form.slug.trim().toLowerCase()
    const own = (tabbed: TabRow) => tabbed.row.targetKey === form.targetKey && tabbed.row.slug === slug && tabbed.row.version === form.version.trim()
    return rows.filter((tabbed) => OPEN_OUTCOMES.has(tabbed.outcome) && !own(tabbed))
}

export const BUSY_BLOCKER = 'Einreichen geht erst, wenn über den anderen Vorschlag entschieden ist.'

export interface WizardStart {
    stage?: DatasetStage
    pkg?: SharedPackage
    suggested?: string
    /** `suggested`, or the same version for „Erneut einreichen“ where allowed. */
    version?: string
    fill?: { targetKey: string; slug: string; version: string }
}

/** Fills nothing for a busy dataset, a started share (it fills its own) or a package found only by name. */
export function wizardStart(
    source: Pick<ExportSource, 'id' | 'name' | 'catalog'>,
    listing: ListingFacts | undefined,
    opening: Opening & { from?: { again?: boolean } },
    targets: readonly string[],
): WizardStart {
    const { from } = opening
    const stage = listing ? datasetStage(source, listing, opening) : undefined
    const pkg = listing ? (from?.slug ? sharedPackageOf(listing.rows, { slug: from.slug, anyInstance: true }, listing.instance) : packageOfSource(source, listing)) : undefined
    const folder = pkg ?? (stage?.kind === 'name-taken' ? stage.pkg : undefined)
    const suggested = listing ? suggestedVersion(folder, source.catalog ? [source.catalog.version] : []) : undefined
    const again = Boolean(from?.again && (!listing?.rows.length || sameVersionAgain(pkg, from.version)))
    const version = again && from ? from.version : suggested
    const fillVersion = from?.version ?? fillVersionOf(pkg)
    const fillSlug = from?.slug ?? pkg?.slug
    // `readNewVersionFill` takes only an exact target: the package's, else the only one.
    const fillTarget = (pkg && pkg.slug === fillSlug ? pkg.targetKey : undefined) ?? (targets.length === 1 ? targets[0] : undefined)
    const asks = stage?.kind !== 'busy' && !opening.started
    return {
        ...(stage ? { stage } : {}),
        ...(pkg ? { pkg } : {}),
        ...(suggested ? { suggested } : {}),
        ...(version ? { version } : {}),
        ...(asks && fillVersion && fillSlug && fillTarget ? { fill: { targetKey: fillTarget, slug: fillSlug, version: fillVersion } } : {}),
    }
}

export type SteckbriefBasics = Record<'displayName' | 'description' | 'slug' | 'publisher' | 'version' | 'domain' | 'maintainer' | 'license' | 'keywords' | 'changeNote', string>

export interface FilledSteckbrief {
    from: string
    targetKey: string
    displayName: string
    description: string
    publisher: string
    slug: string
    /** Only where its proposal names it: the new version's parts keep their ids. */
    domain?: string
    maintainer: string
    license: string
    /** Comma-separated. */
    keywords: string
    metadata: ExportMetadata
    /** Every field copied; else only the package's own, as the rest describes another deployment. */
    full: boolean
    /** Not full because the share names another instance, not none. */
    elsewhere?: boolean
}

export function steckbriefFromManifest(
    raw: string,
    { full, domain, elsewhere }: { full: boolean; domain?: string; elsewhere?: boolean },
): Omit<FilledSteckbrief, 'from' | 'targetKey'> | string {
    const input = catalogInputFromManifest(raw, { repoUrl: '', path: '', commitSha: '' })
    if (typeof input === 'string') return input
    const { publisher, slug } = catalogEntryPath(input.id)
    const themes = input.metadata?.themes
    return {
        displayName: input.displayName,
        description: input.description,
        publisher,
        slug,
        ...(domain ? { domain } : {}),
        maintainer: input.maintainer,
        license: input.license,
        keywords: input.keywords.join(', '),
        metadata: full ? (input.metadata ?? {}) : themes ? { themes } : {},
        full,
        ...(!full && elsewhere ? { elsewhere: true } : {}),
    }
}

export function startingBasics(
    source: Pick<ExportSource, 'name' | 'description' | 'catalog'>,
    defaults: { publisher: string; maintainer: string },
    start: { fill?: Omit<FilledSteckbrief, 'from' | 'targetKey'>; version?: string } = {},
): SteckbriefBasics {
    const { fill, version } = start
    const catalog = source.catalog
    // The catalogue's own split, not another regex: a looser one seeds a slug the server rejects on submit.
    const address = catalog ? catalogEntryPath(catalog.id) : undefined
    return {
        displayName: fill?.displayName ?? catalog?.displayName ?? source.name,
        description: fill?.description ?? catalog?.description ?? source.description ?? '',
        slug: fill?.slug ?? address?.slug ?? slugify(source.name),
        publisher: fill?.publisher ?? address?.publisher ?? defaults.publisher,
        version: version ?? (catalog ? nextPatch(catalog.version) : '1.0.0'),
        domain: fill?.domain ?? 'general',
        maintainer: fill?.maintainer ?? catalog?.maintainer ?? defaults.maintainer,
        license: fill?.license ?? catalog?.license ?? 'EUPL-1.2',
        keywords: fill?.keywords ?? catalog?.keywords.join(', ') ?? '',
        changeNote: '',
    }
}

export interface OpenShare {
    kind: ShareProposal['kind']
    slug: string
    version: string
    iid: number
    url: string
}

const BRANCH_KINDS: [ShareProposal['kind'], (branch: string) => { slug: string; version: string } | undefined][] = [
    ['bundle', parseBundleBranch],
    ['catalog', parseCatalogBranch],
    ['removal', parseRemovalBranch],
]

/** Proposals whose source line names no dataset count for none: nothing is guessed from a name. */
export function openSharesOf(requests: readonly MergeRequestRef[], datasetId: string, botId: number, instance?: string): OpenShare[] {
    return requests.flatMap((mr) => {
        if (mr.state !== 'opened' || mr.author?.id !== botId) return []
        const source = shareSourceOf(mr.description)
        if (source?.id !== datasetId || instanceMatch(source, instance) === 'other') return []
        for (const [kind, parse] of BRANCH_KINDS) {
            const branch = parse(mr.source_branch)
            if (branch) return [{ kind, ...branch, iid: mr.iid, url: mr.web_url }]
        }
        return []
    })
}

export function versionBelow(versions: readonly string[], version: string): string | undefined {
    return versions.filter((candidate) => isNewerVersion(version, candidate)).reduce<string | undefined>((best, candidate) => (!best || isNewerVersion(candidate, best) ? candidate : best), undefined)
}

/** Server side of {@link followedDecline}; an unreadable close by the account may be a withdrawal. */
export function followedHere(
    version: string,
    kind: FollowedDecline['kind'],
    decline: Decline | undefined,
    description: string | null | undefined,
    instance: string | undefined,
): FollowedDecline | undefined {
    if (!decline || (decline.viaMarketplace && decline.reason.kind === 'unreadable')) return undefined
    if (instanceMatch(shareSourceOf(description), instance) === 'other') return undefined
    return { version, kind, decline }
}

export function whatChangedRefusal(followed: FollowedDecline): string {
    return `Nicht eingereicht: ${followedFact(followed)}. Schreib im Steckbrief unter „Was hast du geändert?“, was die neue Version anders macht - das Katalog-Team liest es im neuen Vorschlag.`
}

/** Once gone from the repository, the same number would pass as a package while its entry stays refused. */
export function entryUsedUpRefusal(followed: FollowedDecline, instead: string): string {
    return `Nicht eingereicht: ${followedFact(followed)}. Trag im Steckbrief eine höhere Version ein, zum Beispiel ${instead}.`
}

const OPEN_STAGE: Record<ShareProposal['kind'], string> = { bundle: 'Paket-Prüfung', catalog: 'Eintrags-Prüfung', removal: 'Entfernen' }

export function busyRefusal(open: OpenShare): string {
    return `Nicht eingereicht: Für diesen Datensatz läuft schon ein Vorschlag (Version ${open.version}, ${OPEN_STAGE[open.kind]}, Vorschlag !${open.iid}). Eine neue Version geht erst, wenn über ihn entschieden oder er zurückgezogen ist.`
}

const onBranch = (requests: readonly MergeRequestRef[], parse: (branch: string) => { slug: string; version: string } | undefined, slug: string, version: string) =>
    requests.filter((mr) => {
        const branch = parse(mr.source_branch)
        return branch?.slug === slug && branch.version === version
    })

const withdrawnByMark = (mr: MergeRequestRef) => mr.state === 'closed' && Boolean(withdrawalMarkIn(mr.description, mr.closed_at))

/** Server side of `usedVersions`, without comments: at worst it suggests one version too high. */
export function proposedVersionsIn(requests: readonly MergeRequestRef[], slug: string, botId: number): string[] {
    const own = requests.filter((mr) => mr.author?.id === botId)
    const proposed = new Set(own.flatMap((mr) => {
        const branch = parseBundleBranch(mr.source_branch)
        return branch?.slug === slug ? [branch.version] : []
    }))
    return [...proposed].filter((version) => {
        const entry = onBranch(own, parseCatalogBranch, slug, version)
        if (entry.some((mr) => mr.state === 'merged' || (mr.state === 'closed' && !withdrawnByMark(mr)))) return true
        const removed = onBranch(own, parseRemovalBranch, slug, version).filter((mr) => mr.state === 'merged')
        const since = startedOver(removed.map((mr) => mr.merged_at ?? mr.created_at))
        return onBranch(own, parseBundleBranch, slug, version).some((mr) => sinceStart(mr.created_at, since) && !withdrawnByMark(mr))
    })
}

/** Those whose newest package proposal names this instance or none, as `followedDecline` reads it. */
export function proposedHere(requests: readonly MergeRequestRef[], slug: string, botId: number, instance: string | undefined): string[] {
    const own = requests.filter((mr) => mr.author?.id === botId)
    return proposedVersionsIn(own, slug, botId).filter((version) => {
        const newest = [...onBranch(own, parseBundleBranch, slug, version)].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
        return instanceMatch(shareSourceOf(newest?.description), instance) !== 'other'
    })
}

const sentenceOf = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`)

export function filledNotice(steckbrief: Pick<FilledSteckbrief, 'from' | 'full' | 'elsewhere'>): string {
    const { from } = steckbrief
    if (steckbrief.full) return `Die Angaben sind aus Version ${from} übernommen.`
    const whose = steckbrief.elsewhere ? ', und das ist eine andere als deine' : ' - welche das war, ist nicht bekannt'
    return (
        `Die Angaben sind aus Version ${from} übernommen - bis auf Umsetzung, Kontakt, Kosten, Wirkungslogik, Kooperation und Bilder. ` +
        `Diese Abschnitte gehören zu der Instanz, die Version ${from} geteilt hat${whose}. Ergänze sie für deine Instanz, soweit du sie kennst.`
    )
}

export function unfilledNotice(from: string, detail: string | undefined): string {
    return `Die Angaben aus Version ${from} ließen sich nicht übernehmen${detail ? `: ${sentenceOf(detail)}` : '.'} Die Felder sind vorbelegt wie bei einem neuen Paket.`
}

export function whatChangedLead(followed: FollowedDecline): string {
    return `Die neue Version folgt auf Vorschlag !${followed.decline.iid}: ${followedFact(followed)}. Schreib kurz, was die neue Version anders macht.`
}
