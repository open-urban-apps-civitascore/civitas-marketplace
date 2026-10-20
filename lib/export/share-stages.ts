import { verificationLabel } from '@/lib/export/labels'
import type { BundleStatus, CatalogStatus } from '@/lib/export/status'

/**
 * Where a shared package version stands, in the four stages of sharing (Ewa's
 * plan of 2026-10-13, point 8): one place that tells it, so the last step of
 * the wizard, "In Arbeit" and "Veröffentlicht" all say the same. Pure, for
 * client components.
 *
 * Two of the stages are the person's own move, two are the catalogue team's:
 * they accept the package, and then the entry. Both proposals go to the same
 * people, so the page names them once, "das Katalog-Team" (plan of
 * 2026-10-18). Saying whose move it is, is the point - a person who left after
 * proposing has to know whether anything waits for them.
 *
 * Withdrawing a share (see `share-deletion.ts`) adds two endings: a proposal
 * closed by the marketplace itself is "Zurückgezogen", and a merged version
 * goes out again only through a merge request of its own, which the
 * catalogue team decides on like the first. The catalogue team adds a
 * third: a version they took out of the catalogue (`CatalogStatus` state
 * `withdrawn`) is finished for good, and is never proposed for it again.
 *
 * "Finished" means nothing is left that the marketplace could move on: that
 * includes a merged version that is no longer, or not as such, in the
 * repository. It keeps its reason (`blockedBy`) for the list of shared
 * packages, but no longer asks anyone in "In Arbeit" for a move nobody can
 * make (Ewa, 2026-10-17).
 */

export type StageKey = 'propose' | 'review' | 'catalog' | 'listing'

/**
 * - `done`: behind us
 * - `current`: the person's own move, now
 * - `waiting`: someone else's move, now
 * - `blocked`: would be next, but something stops it (see `blockedBy`)
 * - `later`: not yet
 */
export type StageState = 'done' | 'current' | 'waiting' | 'blocked' | 'later'

export interface Stage {
    key: StageKey
    title: string
    /** The stage in one or two words, as the progress line of „In Arbeit“ and its status sentence name it. */
    short: string
    /** Whose move the stage is, as a line starts with them. */
    who: string
    turn: 'you' | 'reviewers'
}

export const STAGES: readonly Stage[] = [
    { key: 'propose', title: 'Paket einreichen', short: 'Einreichen', who: 'Du', turn: 'you' },
    { key: 'review', title: 'Paket-Prüfung', short: 'Paket-Prüfung', who: 'Das Katalog-Team', turn: 'reviewers' },
    { key: 'catalog', title: 'Katalog-Eintrag vorschlagen', short: 'Katalog-Eintrag', who: 'Du', turn: 'you' },
    { key: 'listing', title: 'Eintrags-Prüfung', short: 'Eintrags-Prüfung', who: 'Das Katalog-Team', turn: 'reviewers' },
]

/** What a stage, a row or a removal says while the catalogue team has the next move. */
export const WAITING_FOR_TEAM = 'Wartet auf das Katalog-Team'

/** What is known about one package version. Any of it may be missing. */
export interface ShareFacts {
    /** The version these facts are about, to tell a newer version on the base branch from an older one. */
    version?: string
    /** The state of the version's newest merge request, as GitLab names it; absent when none was opened. */
    bundleMrState?: string
    /** With the version's removal, if one was proposed (`BundleStatus.removal`). */
    bundle?: BundleStatus
    catalog?: CatalogStatus
    /** The version's merge request was closed through the marketplace, with its withdrawal note: taken back, not turned down. */
    withdrawn?: boolean
}

/** True when `candidate` is a higher x.y.z than `version`; false whenever either is no plain version. */
export function isNewerVersion(candidate: string, version: string): boolean {
    const parse = (value: string) => value.match(/^(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number)
    const a = parse(candidate)
    const b = parse(version)
    if (!a || !b) return false
    for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index]
    return false
}

/** "Grund: …" with exactly one full stop, whether or not the catalogue team ended their reason with one. */
function sentence(text: string): string {
    return /[.!?]$/.test(text) ? text : `${text}.`
}

/** Who took which version out of the catalogue, and why when they said. */
export function takenOutFact(takenOut: { version: string; reason?: string }): string {
    const reason = takenOut.reason ? ` Grund: ${sentence(takenOut.reason)}` : ''
    return `Das Katalog-Team hat Version ${takenOut.version} aus dem Katalog genommen.${reason}`
}

/**
 * What the person learns where a version of their package was taken out of
 * the catalogue (decided 2026-10-18): who decided, and that a new version
 * should wait for a word with them. Shown as a neutral notice: nobody on the
 * page can undo it.
 */
export function takenOutNotice(takenOut: { version: string; reason?: string }): string {
    return `${takenOutFact(takenOut)} Frag dort nach, bevor du eine neue Version teilst.`
}

/**
 * Why `version` does not go into the catalogue: it was there itself, or the
 * catalogue team took out the whole entry (`revoked`), which shuts out every
 * version until they let it in again - then "nicht noch einmal" would be
 * wrong for a version that was never there.
 */
export function takenOutBlocker(takenOut: { version: string } | undefined, version: string | undefined): string {
    return takenOut && version && takenOut.version !== version
        ? 'Herausgenommen ist der ganze Eintrag: auch eine neue Version kommt erst in den Katalog, wenn das Katalog-Team ihn wieder freigibt.'
        : 'Diese Version kommt nicht noch einmal in den Katalog.'
}

/** "Aus dem Katalog genommen", with the reason when there is one. */
function takenOutSummary(takenOut: { reason?: string } | undefined): string {
    const reason = takenOut?.reason?.replace(/[.!?]+$/, '')
    return reason ? `Aus dem Katalog genommen - ${reason}` : 'Aus dem Katalog genommen'
}

/** Why a merged package is not where it should be, in the person's words. */
function missingFromBase(bundle: BundleStatus, version: string | undefined): string {
    switch (bundle.reason) {
        case 'no-base-branch':
            return `${bundle.detail ?? 'Der Ablageort ist nicht vollständig eingerichtet'} - das richtet der Betrieb ein.`
        case 'bad-manifest':
            return 'Die manifest.json des Pakets im Ablageort ist kein gültiges JSON.'
        case 'other-version':
            return `Im Ablageort liegt ${bundle.onBase?.version ?? 'eine andere Version'}${version ? ` statt ${version}` : ''} - bitte ansehen.`
        default:
            return 'Das Paket liegt nicht mehr im Ablageort - jemand hat es nach der Annahme entfernt oder verschoben.'
    }
}

export interface ShareProgress {
    states: Record<StageKey, StageState>
    /** The stage that needs someone now; absent when nothing is open. */
    active?: StageKey
    /** Whose move `active` is; absent when only the operator can help (no catalogue set up). */
    turn?: 'you' | 'reviewers'
    /** Why `active` cannot go on, in the person's words. */
    blockedBy?: string
    /**
     * Nothing more to do here: in the catalogue, replaced by a newer version,
     * closed without a merge, removed - or nothing the marketplace can move on
     * (`blockedBy` says why).
     */
    finished: boolean
    /**
     * The version is on its way out of the repository (`pending`, the reviewers
     * decide) or out (`done`). Outside the four stages: it undoes them.
     */
    removal?: 'pending' | 'done'
    /** Where the version stands, in one line. */
    summary: string
}

const states = (propose: StageState, review: StageState, catalog: StageState, listing: StageState): Record<StageKey, StageState> => ({
    propose,
    review,
    catalog,
    listing,
})

export function shareProgress({ version, bundleMrState, bundle, catalog, withdrawn }: ShareFacts): ShareProgress {
    // A version proposed again is under review again, whatever became of it before.
    if (bundle?.state === 'mr-open' || (!bundle && bundleMrState === 'opened')) {
        return {
            states: states('done', 'waiting', 'later', 'later'),
            active: 'review',
            turn: 'reviewers',
            finished: false,
            summary: 'Paket in Prüfung',
        }
    }

    // Taking a merged version out again is a merge request too, so the catalogue team decides again.
    const removal = bundle?.removal?.state
    if (removal === 'opened') {
        return { states: states('done', 'done', 'later', 'later'), turn: 'reviewers', removal: 'pending', finished: false, summary: 'Entfernen vorgeschlagen' }
    }
    // Only while the version is gone: shared and merged once more, it is back.
    if (removal === 'merged' && bundle && bundle.state !== 'on-base') {
        return { states: states('done', 'done', 'later', 'later'), removal: 'done', finished: true, summary: 'Paket entfernt' }
    }

    if (bundle?.state === 'on-base') {
        // The catalogue team's decision comes first: nothing about the package changes it.
        if (catalog?.state === 'withdrawn') {
            return {
                states: states('done', 'done', 'blocked', 'later'),
                blockedBy: takenOutBlocker(catalog.takenOut, version),
                finished: true,
                summary: takenOutSummary(catalog.takenOut),
            }
        }
        // Proposed again after it was taken out (!27, !29, !30 on the demo): the person who can withdraw it is asked to.
        if (catalog?.state === 'mr-open' && catalog.bringsBack) {
            return {
                states: states('done', 'done', 'done', 'blocked'),
                active: 'listing',
                turn: 'you',
                blockedBy: 'Der offene Katalog-Vorschlag würde einen Eintrag zurückbringen, den das Katalog-Team herausgenommen hat - zieh den Vorschlag unter „In Arbeit“ zurück.',
                finished: false,
                summary: 'Katalog-Eintrag in Prüfung - bringt einen herausgenommenen Eintrag zurück',
            }
        }
        const verification = bundle.verification
        if (verification && verification.state !== 'verified') {
            return {
                states: states('done', 'done', 'blocked', 'later'),
                active: 'catalog',
                turn: 'you',
                blockedBy: `Das Paket im Ablageort lässt sich nicht bestätigen (${verificationLabel(verification)}). Bitte ansehen oder eine neue Version teilen.`,
                finished: false,
                summary: 'Paket angenommen - braucht einen Blick',
            }
        }
        if (catalog?.state === 'listed') {
            return { states: states('done', 'done', 'done', 'done'), finished: true, summary: 'Im Katalog' }
        }
        if (catalog?.state === 'mr-open') {
            return {
                states: states('done', 'done', 'done', 'waiting'),
                active: 'listing',
                turn: 'reviewers',
                finished: false,
                summary: 'Katalog-Eintrag in Prüfung',
            }
        }
        if (catalog?.state === 'unconfigured') {
            return {
                states: states('done', 'done', 'blocked', 'later'),
                active: 'catalog',
                blockedBy: 'Der Katalog ist auf dieser Instanz noch nicht eingerichtet - das richtet der Betrieb ein.',
                finished: false,
                summary: 'Paket angenommen - Katalog nicht eingerichtet',
            }
        }
        return {
            states: states('done', 'done', 'current', 'later'),
            active: 'catalog',
            turn: 'you',
            finished: false,
            summary: 'Paket angenommen - jetzt Katalog-Eintrag vorschlagen',
        }
    }

    if (bundleMrState === 'merged') {
        // A newer version on the base branch took its place: nothing left to do for this one.
        if (bundle?.reason === 'other-version' && bundle.onBase && version && isNewerVersion(bundle.onBase.version, version)) {
            return { states: states('done', 'done', 'later', 'later'), finished: true, summary: `Durch Version ${bundle.onBase.version} ersetzt` }
        }
        // Not read (the row says why), so not judged.
        if (!bundle) return { states: states('done', 'done', 'later', 'later'), finished: false, summary: 'Paket angenommen' }
        // Merged, yet missing or different on the base branch: the catalogue step cannot follow, and
        // no button here changes that - sharing again can. Said where it is listed, asked of nobody.
        return {
            states: states('done', 'done', 'blocked', 'later'),
            blockedBy: missingFromBase(bundle, version),
            finished: true,
            summary: 'Paket angenommen, aber nicht mehr im Ablageort',
        }
    }
    if (bundleMrState === 'closed') {
        return {
            states: states('later', 'later', 'later', 'later'),
            finished: true,
            summary: withdrawn ? 'Zurückgezogen' : 'Nicht angenommen',
        }
    }

    // A version that was in the catalogue is used up: not even its package is proposed again.
    if (catalog?.state === 'withdrawn' && version && catalog.takenOut?.version === version) {
        return {
            states: states('blocked', 'later', 'later', 'later'),
            blockedBy: 'Diese Version war schon im Katalog und lässt sich nicht noch einmal teilen - nur eine höhere.',
            finished: true,
            summary: takenOutSummary(catalog.takenOut),
        }
    }

    return {
        states: states('current', 'later', 'later', 'later'),
        active: 'propose',
        turn: 'you',
        finished: false,
        summary: 'Noch nicht eingereicht',
    }
}

/** "Du bist dran", or that the catalogue team is; undefined when nobody on either side can move. */
export function turnLabel(progress: ShareProgress): string | undefined {
    // The catalogue team decides on a removal, as it did on the package.
    if (progress.removal === 'pending') return WAITING_FOR_TEAM
    if (!progress.active || !progress.turn) return undefined
    return progress.turn === 'you' ? 'Du bist dran' : WAITING_FOR_TEAM
}
