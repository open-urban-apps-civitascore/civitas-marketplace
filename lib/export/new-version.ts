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

/**
 * Where a dataset stands before a new version of it is started (busy, in the
 * catalogue, turned down, taken out), which version to suggest, what the
 * Steckbrief is filled from and whether it follows a "no" - and the server's
 * side of the same rules. Pure: GitLab and the listing are read elsewhere.
 */

// ── One package, as the listing knows it ────────────────────────────────────

// Kept in `shared-package.ts`, so „Beendet“ loads them without this module's catalogue and form code.
export { sameVersionAgain, sharedPackageOf, usedVersions, type PackageMatch, type SharedPackage, type VersionFact } from '@/lib/export/shared-package'

/** The version a new one is suggested at: above every used-up one of the package and above `also` (an installed dataset's catalogue version). */
export function suggestedVersion(pkg: SharedPackage | undefined, also: readonly string[] = []): string {
    return aboveAll([...(pkg ? usedVersions(pkg) : []), ...also])
}

/** The version a new Steckbrief is filled from: the highest proposed, whatever became of it (its text is the newest), unless unreadable. */
export function fillVersionOf(pkg: SharedPackage | undefined): string | undefined {
    return pkg?.versions.find((fact) => fact.outcome !== 'unreadable')?.version
}

// ── A new version after a "no" ──────────────────────────────────────────────

/** The "no" a new version follows: to the package of the version before it, or to that version's catalogue entry. */
export interface FollowedDecline {
    version: string
    kind: 'package' | 'entry'
    decline: Decline
}

/** Outcomes where a version's entry may be what was turned down: after a "no" to its removal too, or once it left the repository. */
const ENTRY_NO_OUTCOMES: ReadonlySet<ShareOutcome> = new Set(['entry-declined', 'removal-declined', 'removed', 'gone'])

/** Where a proposal came from: its own source line where it names an instance, else what its version's row says. */
const originOf = (proposal: ShareProposal | undefined, row: SharedPackageRow) => (proposal?.source?.instance ? proposal.source : row.source)

/**
 * The "no" a new version of the package follows: the last decision about it
 * was the catalogue team turning down its highest version, package or entry.
 * None after a withdrawal or a "no" that may have been one (`mayBeWithdrawn`).
 * Another instance's versions are passed over: its people answer its "no", and
 * instances share one account. The server mirrors this (`followedHere`).
 */
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

/**
 * Whether the server's answer tells of a "no" the listing does not know yet, so
 * the page reads the listing again. One the listing has, by its proposal, is no
 * news; before the listing was read, every one is.
 */
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

/** Whether „Was hast du geändert?“ is asked: `version` is above the one turned down (a lower or equal one is refused anyway). */
export function asksWhatChanged(followed: FollowedDecline | undefined, version: string): followed is FollowedDecline {
    return Boolean(followed && isNewerVersion(version.trim(), followed.version))
}

/** „Version 1.1.4 hat das Katalog-Team am 22.10. nicht angenommen“, or the same of its entry. */
export function followedFact(followed: FollowedDecline): string {
    if (followed.kind === 'package') return `Version ${followed.version} ${declinedBy(followed.decline)}`
    return `${followed.decline.viaMarketplace ? 'Der' : 'Den'} Katalog-Eintrag für Version ${followed.version} ${declinedBy(followed.decline)}`
}

/** How long „Was hast du geändert?“ may be: it stands in the new proposal, in one line. */
export const CHANGE_NOTE_MAX = 500

/** The turned-down proposal a new version follows. */
export interface FollowsRef {
    iid: number
    url: string
    closedAt?: string
}

export function followsRefOf(followed: FollowedDecline): FollowsRef {
    return { iid: followed.decline.iid, url: followed.decline.mrUrl, ...(followed.decline.closedAt ? { closedAt: followed.decline.closedAt } : {}) }
}

/**
 * The form's `follows`, read back defensively: undefined for none, null for a
 * malformed one or one whose number is not its URL's. http is allowed (the
 * catalogue may be served either way); whose project it is, the server checks.
 */
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

/** Why „Was hast du geändert?“ is not taken (1 to {@link CHANGE_NOTE_MAX} characters), or undefined. */
export function changeNoteProblem(note: string): string | undefined {
    const length = Array.from(note.trim()).length
    if (length === 0) return 'Was hast du geändert? Bitte kurz beschreiben - das Katalog-Team liest es im neuen Vorschlag.'
    if (length > CHANGE_NOTE_MAX) return `Was hast du geändert? Bitte höchstens ${CHANGE_NOTE_MAX} Zeichen.`
    return undefined
}

const ISO_DAY = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Berlin' })

/**
 * "Follows !N (not accepted on <date>). What changed, in <name>'s words: …".
 * The words become one line with angle brackets escaped, so they cannot pass
 * for a line the marketplace reads back (source line, withdrawal mark). Linked,
 * as the proposal followed may be in another repository than „!N“ points into.
 */
export function followsLine(ref: FollowsRef, note: string, by: string): string {
    const closed = ref.closedAt ? Date.parse(ref.closedAt) : NaN
    const when = Number.isNaN(closed) ? 'not accepted' : `not accepted on ${ISO_DAY.format(closed)}`
    const words = note.replace(/\s+/g, ' ').trim().replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const who = by && by !== 'unbekannt' ? `${by}'s` : "the sharer's"
    return `Follows [!${ref.iid}](${ref.url}) (${when}). What changed, in ${who} words: "${words}"`
}

// ── What „Auswählen“ says about a dataset ───────────────────────────────────

/** What the listing says, once it was read: the rows, the busy datasets of the tab rules, and this instance. */
export interface ListingFacts {
    rows: readonly SharedPackageRow[]
    busy: ReadonlyMap<string, TabRow[]>
    instance?: string
}

/** How the new version is started: from a row's „Neue Version teilen“ (`from`), or continuing a share started in this browser. */
export interface Opening {
    from?: { version: string; slug?: string }
    started?: boolean
}

/**
 * Whether `from` leads on from this row: its package (where named) at its
 * version or a higher one. So „Neue Version teilen“ on a version turned down
 * above an accepted one (1.1.0 accepted, 1.1.1 turned down) leads on from both.
 */
const namedBy = (tabbed: TabRow, from: Opening['from']) =>
    Boolean(from && (!from.slug || tabbed.row.slug === from.slug) && !isNewerVersion(tabbed.row.version, from.version))

/**
 * The rows that stand in the way of a new version: every one with a proposal
 * open (the server refuses next to those too), and one accepted without an
 * entry yet - unless the new version leads on from it (`namedBy`) or a share of
 * it was started in this browser.
 */
export function blockingRows(busy: readonly TabRow[] | undefined, opening: Opening = {}): TabRow[] {
    return (busy ?? []).filter((tabbed) => OPEN_OUTCOMES.has(tabbed.outcome) || !(opening.started || namedBy(tabbed, opening.from)))
}

/**
 * Where a dataset stands for a new version, in the order a person needs it.
 * `name-taken`: nothing shared from here, but its short name is another
 * instance's package. `whole`: the whole entry was taken out, and no version
 * gets in until the catalogue team lets it in again.
 */
export type DatasetStage =
    | { kind: 'busy'; rows: TabRow[] }
    | { kind: 'declined'; followed: FollowedDecline }
    | { kind: 'taken-out'; takenOut: { version: string; reason?: string }; whole: boolean }
    | { kind: 'listed'; version: string; name: string }
    | { kind: 'name-taken'; slug: string; pkg: SharedPackage }
    | { kind: 'none' }

/** The short name a dataset is shared under unless the person changes it: the catalogue's, where it was installed from there, else its own name's. */
export function defaultSlugOf(source: Pick<ExportSource, 'name' | 'catalog'>): string {
    return source.catalog ? catalogEntryPath(source.catalog.id).slug : slugify(source.name)
}

/**
 * The package a dataset was, or by default would be, shared as. By name only
 * among this instance's shares, unless installed from the catalogue: then it is
 * that entry's package, whoever shared it before.
 */
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
    // Someone else's package, but the same folder unless the person picks another short name.
    const slug = defaultSlugOf(source)
    const taken = pkg ? undefined : nameTakenIn(listing.rows, slug, listing.instance)
    if (taken) return { kind: 'name-taken', slug, pkg: taken }
    return { kind: 'none' }
}

/**
 * The package under `slug` when only other instances shared into it: a dataset
 * here that keeps that short name becomes a new version of theirs. A version
 * that names no instance counts as this one's.
 */
export function nameTakenIn(rows: readonly SharedPackageRow[], slug: string, instance: string | undefined, targetKey?: string): SharedPackage | undefined {
    const pkg = sharedPackageOf(rows, { slug, anyInstance: true, ...(targetKey ? { targetKey } : {}) }, instance)
    return pkg?.versions.every((fact) => instanceMatch(fact.row.source, instance) === 'other') ? pkg : undefined
}

/** „1.0.1, 1.1.0“: the versions of the rows, lowest first. */
export function versionsOf(rows: readonly TabRow[]): string {
    return [...new Set(rows.map((tabbed) => tabbed.row.version))].sort((a, b) => -higherFirst({ version: a }, { version: b })).join(', ')
}

/** The quieter second line of an option in „Auswählen“; none where nothing was shared. */
export function stageHint(stage: DatasetStage): string | undefined {
    switch (stage.kind) {
        case 'busy':
            return `In Arbeit (${versionsOf(stage.rows)}) - nicht wählbar`
        case 'declined':
            // An entry turned down leaves its package accepted: only the entry was not taken.
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

/** The stage of a busy row in a sentence: „Paket-Prüfung“, „Eintrags-Prüfung“, „Entfernen“ - or „Katalog-Eintrag“ for one accepted. */
function busyStage(tabbed: TabRow): string {
    if (tabbed.outcome === 'removal-pending') return 'Entfernen'
    return STAGES.find((stage) => stage.key === tabbed.progress.active)?.short ?? STAGES[2].short
}

/** A notice „Auswählen“ shows once a dataset is chosen: its words, and where it leads when it leads anywhere. */
export interface StageNotice {
    text: string
    link?: { label: string; href: string }
}

/** What an accepted version's row in „In Arbeit“ offers next, as the busy notice says it. */
function nextOnRow(tabbed: TabRow): string {
    if (tabbed.outcome === 'accepted' || (tabbed.outcome === 'removal-declined' && mayProposeEntry(tabbed.row))) {
        return 'Unter „In Arbeit“ schlägst du den Katalog-Eintrag vor oder teilst eine neue Version.'
    }
    return tabbed.outcome === 'removal-declined' ? 'Unter „In Arbeit“ teilst du eine neue Version.' : 'Unter „In Arbeit“ steht, was als Nächstes geht.'
}

/**
 * What „Auswählen“ says under the dropdown once the dataset is chosen, each a
 * neutral fact. Busy is reached only through a link or a race: it says what
 * runs and where it goes on, with no button.
 */
export function stageNotice(stage: DatasetStage, datasetName: string): StageNotice | undefined {
    switch (stage.kind) {
        case 'busy': {
            const open = stage.rows.find((tabbed) => OPEN_OUTCOMES.has(tabbed.outcome))
            const shown = open ?? stage.rows[0]
            const link = { label: 'Zu „In Arbeit“', href: inProgressHref(shown.row) }
            // The link says where it goes on, so the sentence does not.
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

/**
 * The rows that keep the form at steps 2 and 3 from submitting: those with a
 * proposal open, as the server refuses only next to those, but not the form's
 * own version - once submitted, that is its own proposal in review.
 */
export function busyBeside(rows: readonly TabRow[], form: { targetKey: string; slug: string; version: string }): TabRow[] {
    const slug = form.slug.trim().toLowerCase()
    const own = (tabbed: TabRow) => tabbed.row.targetKey === form.targetKey && tabbed.row.slug === slug && tabbed.row.version === form.version.trim()
    return rows.filter((tabbed) => OPEN_OUTCOMES.has(tabbed.outcome) && !own(tabbed))
}

/** Said in place of „Zur Prüfung einreichen“ while another proposal is open: neutral, as it is no problem. */
export const BUSY_BLOCKER = 'Einreichen geht erst, wenn über den anderen Vorschlag entschieden ist.'

/** How `ExportPanel` starts a new version: see {@link wizardStart}. */
export interface WizardStart {
    /** Where the dataset stands; absent while the listing is not read. */
    stage?: DatasetStage
    /** The package a link names, else the dataset's (`packageOfSource`). */
    pkg?: SharedPackage
    /** The next free version; absent while the listing is not read. */
    suggested?: string
    /** Where the form starts: the same version for „Erneut einreichen“ where allowed, else `suggested`. */
    version?: string
    /** The shared version the Steckbrief is filled from (`readNewVersionFill`), where there is one. */
    fill?: { targetKey: string; slug: string; version: string }
}

/**
 * The stage, package, suggested version and fill of a new version. Nothing is
 * filled for a busy dataset, next to a share started in this browser (it fills
 * in its own), or from another instance's package found only by name.
 * „Erneut einreichen“ keeps the version unless the listing says it is used up.
 */
export function wizardStart(
    source: Pick<ExportSource, 'id' | 'name' | 'catalog'>,
    listing: ListingFacts | undefined,
    opening: Opening & { from?: { again?: boolean } },
    /** The places packages go, by key. */
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

// ── The Steckbrief a new version starts with ────────────────────────────────

/** The Steckbrief's basic fields as the form holds them, „Was hast du geändert?“ (`changeNote`) among them. */
export type SteckbriefBasics = Record<'displayName' | 'description' | 'slug' | 'publisher' | 'version' | 'domain' | 'maintainer' | 'license' | 'keywords' | 'changeNote', string>

/** What the Steckbrief takes from a shared version (`readNewVersionFill` in new-version-fill.ts). */
export interface FilledSteckbrief {
    /** The version it was filled from. */
    from: string
    targetKey: string
    displayName: string
    description: string
    publisher: string
    slug: string
    /** Where its proposal names it: the parts of the new version keep their ids. */
    domain?: string
    maintainer: string
    license: string
    /** Comma-separated, as the field holds them. */
    keywords: string
    metadata: ExportMetadata
    /** Every field was copied, as the share came from this instance; else only the package's own (contact, implementation, pictures describe another deployment). */
    full: boolean
    /** Not copied in full because the share names another instance, rather than none. */
    elsewhere?: boolean
}

/** The Steckbrief of a shared version, from the manifest at the proposal's last commit; a string names what is wrong with it. */
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

/**
 * The basic fields a Steckbrief starts with: a shared version's (`fill`) over an
 * installed dataset's catalogue data, over the defaults; the version as
 * suggested, else one above the catalogue's. A started share fills in its own on top.
 */
export function startingBasics(
    source: Pick<ExportSource, 'name' | 'description' | 'catalog'>,
    defaults: { publisher: string; maintainer: string },
    start: { fill?: Omit<FilledSteckbrief, 'from' | 'targetKey'>; version?: string } = {},
): SteckbriefBasics {
    const { fill, version } = start
    const catalog = source.catalog
    // The catalogue's own split, not a fourth regex for it: a looser pattern here
    // seeds a slug the server then rejects, and the author finds out on submit.
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

// ── The server's side ───────────────────────────────────────────────────────

/** One proposal open at GitLab, as the server's check for a busy dataset reads it. */
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

/**
 * The account's proposals open for one dataset, by the source line naming it,
 * from this instance or one that names none. Older proposals that name no
 * dataset count for none: nothing is guessed from a name.
 */
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

/** The highest of `versions` below `version`: the one a new version comes after. */
export function versionBelow(versions: readonly string[], version: string): string | undefined {
    return versions.filter((candidate) => isNewerVersion(version, candidate)).reduce<string | undefined>((best, candidate) => (!best || isNewerVersion(candidate, best) ? candidate : best), undefined)
}

/**
 * The server's reading of {@link followedDecline}. None where the account closed
 * the proposal and its comments could not be read (it may have been a
 * withdrawal), or where its source line names another instance.
 */
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

/** Why a new version is not submitted without „Was hast du geändert?“ where the page did not know of the "no" yet; the answer carries it, so the Steckbrief asks. */
export function whatChangedRefusal(followed: FollowedDecline): string {
    return `Nicht eingereicht: ${followedFact(followed)}. Schreib im Steckbrief unter „Was hast du geändert?“, was die neue Version anders macht - das Katalog-Team liest es im neuen Vorschlag.`
}

/**
 * Why a version whose entry was turned down is not submitted again: once it
 * left the repository, the same number would pass as a package while its entry
 * stays refused for good.
 */
export function entryUsedUpRefusal(followed: FollowedDecline, instead: string): string {
    return `Nicht eingereicht: ${followedFact(followed)}. Trag im Steckbrief eine höhere Version ein, zum Beispiel ${instead}.`
}

const OPEN_STAGE: Record<ShareProposal['kind'], string> = { bundle: 'Paket-Prüfung', catalog: 'Eintrags-Prüfung', removal: 'Entfernen' }

/** Why a new version of a dataset is not submitted while another of its proposals is open (the server's check of the greyed-out choice). */
export function busyRefusal(open: OpenShare): string {
    return `Nicht eingereicht: Für diesen Datensatz läuft schon ein Vorschlag (Version ${open.version}, ${OPEN_STAGE[open.kind]}, Vorschlag !${open.iid}). Eine neue Version geht erst, wenn über ihn entschieden oder er zurückgezogen ist.`
}

/** The account's requests from the branch `parse` reads as `slug` at `version`. */
const onBranch = (requests: readonly MergeRequestRef[], parse: (branch: string) => { slug: string; version: string } | undefined, slug: string, version: string) =>
    requests.filter((mr) => {
        const branch = parse(mr.source_branch)
        return branch?.slug === slug && branch.version === version
    })

/** Closed with the withdrawal mark: taken back, nothing decided. */
const withdrawnByMark = (mr: MergeRequestRef) => mr.state === 'closed' && Boolean(withdrawalMarkIn(mr.description, mr.closed_at))

/**
 * The versions in a package's folder a refusal counts as used up, as
 * `usedVersions` does on the page but from one listing without comments: a
 * package proposal since the version last started over and not withdrawn by
 * mark, or an entry decided. At worst this suggests one version too high.
 */
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

/**
 * Of `proposedVersionsIn`, those whose newest package proposal names this
 * instance or none: the server's side of `followedDecline`, which passes other
 * instances over.
 */
export function proposedHere(requests: readonly MergeRequestRef[], slug: string, botId: number, instance: string | undefined): string[] {
    const own = requests.filter((mr) => mr.author?.id === botId)
    return proposedVersionsIn(own, slug, botId).filter((version) => {
        const newest = [...onBranch(own, parseBundleBranch, slug, version)].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
        return instanceMatch(shareSourceOf(newest?.description), instance) !== 'other'
    })
}

// ── What the Steckbrief says about where it was filled from ─────────────────

/** A detail as a sentence of its own, with exactly one full stop. */
const sentenceOf = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`)

/**
 * Over the Steckbrief once filled from a shared version: from which, and which
 * sections stay empty and why, so an empty contact is no surprise. "Another
 * instance" only where the share names one: an older share may name none.
 */
export function filledNotice(steckbrief: Pick<FilledSteckbrief, 'from' | 'full' | 'elsewhere'>): string {
    const { from } = steckbrief
    if (steckbrief.full) return `Die Angaben sind aus Version ${from} übernommen.`
    const whose = steckbrief.elsewhere ? ', und das ist eine andere als deine' : ' - welche das war, ist nicht bekannt'
    return (
        `Die Angaben sind aus Version ${from} übernommen - bis auf Umsetzung, Kontakt, Kosten, Wirkungslogik, Kooperation und Bilder. ` +
        `Diese Abschnitte gehören zu der Instanz, die Version ${from} geteilt hat${whose}. Ergänze sie für deine Instanz, soweit du sie kennst.`
    )
}

/** Where they could not be taken: why, and what the form holds instead. */
export function unfilledNotice(from: string, detail: string | undefined): string {
    return `Die Angaben aus Version ${from} ließen sich nicht übernehmen${detail ? `: ${sentenceOf(detail)}` : '.'} Die Felder sind vorbelegt wie bei einem neuen Paket.`
}

/** Under „Was hast du geändert?“: the "no" it answers; the field's hint says who reads the text. */
export function whatChangedLead(followed: FollowedDecline): string {
    return `Die neue Version folgt auf Vorschlag !${followed.decline.iid}: ${followedFact(followed)}. Schreib kurz, was die neue Version anders macht.`
}
