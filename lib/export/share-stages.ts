import { verificationLabel } from '@/lib/export/labels'
import type { BundleStatus, CatalogStatus } from '@/lib/export/status'

/**
 * Where a shared package version stands, in the four stages of sharing (Ewa's
 * plan of 2026-10-13, point 8): one place that tells it, so the last step of
 * "Teilen", "In Arbeit" and "Geteilte Pakete" all say the same. Pure, for
 * client components.
 *
 * Two of the stages are the person's own move, two are someone else's: the
 * reviewers of the package repository merge the package, the reviewers of
 * the catalogue take the entry in. Saying whose move it is, is the point - a
 * person who left after proposing has to know whether anything waits for them.
 *
 * Deleting a share (see `share-deletion.ts`) adds two endings: a proposal
 * closed by the marketplace itself is "Zurückgezogen", and a merged version
 * goes out again only through a merge request of its own, which the
 * repository's reviewers decide on like the first.
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
    /** Whose move the stage is, as the page names them. */
    who: string
    turn: 'you' | 'reviewers'
}

export const STAGES: readonly Stage[] = [
    { key: 'propose', title: 'Paket zur Prüfung vorschlagen', who: 'Du', turn: 'you' },
    { key: 'review', title: 'Prüfung und Merge', who: 'Prüfende im Repository', turn: 'reviewers' },
    { key: 'catalog', title: 'Katalog-Eintrag vorschlagen', who: 'Du', turn: 'you' },
    { key: 'listing', title: 'Aufnahme in den Katalog', who: 'Prüfende im Katalog', turn: 'reviewers' },
]

/** What is known about one package version. Any of it may be missing. */
export interface ShareFacts {
    /** The version these facts are about, to tell a newer version on the base branch from an older one. */
    version?: string
    /** The state of the version's newest merge request, as GitLab names it; absent when none was opened. */
    bundleMrState?: string
    /** With the version's removal, if one was proposed (`BundleStatus.removal`). */
    bundle?: BundleStatus
    catalog?: CatalogStatus
    /** The version's merge request was closed by the marketplace's own account: taken back, not turned down. */
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

/** Why a merged package is not where it should be, in the person's words. */
function missingFromBase(bundle: BundleStatus, version: string | undefined): string {
    switch (bundle.reason) {
        case 'no-base-branch':
            return bundle.detail ?? 'Der Basisbranch fehlt im Repository.'
        case 'bad-manifest':
            return 'Die manifest.json des Pakets im Repository ist kein gültiges JSON.'
        case 'other-version':
            return `Im Repository liegt ${bundle.onBase?.version ?? 'eine andere Version'}${version ? ` statt ${version}` : ''} - bitte prüfen.`
        default:
            return 'Das Paket liegt nicht mehr im Repository - jemand hat es nach dem Merge entfernt oder verschoben.'
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
            summary: 'Paket wartet auf Prüfung',
        }
    }

    // Taking a merged version out again is a merge request too, so the same reviewers decide.
    const removal = bundle?.removal?.state
    if (removal === 'opened') {
        return { states: states('done', 'done', 'later', 'later'), turn: 'reviewers', removal: 'pending', finished: false, summary: 'Entfernen wartet auf Prüfung' }
    }
    // Only while the version is gone: shared and merged once more, it is back.
    if (removal === 'merged' && bundle && bundle.state !== 'on-base') {
        return { states: states('done', 'done', 'later', 'later'), removal: 'done', finished: true, summary: 'Aus dem Repository entfernt' }
    }

    if (bundle?.state === 'on-base') {
        const verification = bundle.verification
        if (verification && verification.state !== 'verified') {
            return {
                states: states('done', 'done', 'blocked', 'later'),
                active: 'catalog',
                turn: 'you',
                blockedBy: `Der Stand im Repository lässt sich nicht bestätigen (${verificationLabel(verification)}). Bitte prüfen, oder neu teilen.`,
                finished: false,
                summary: 'Paket gemergt - braucht einen Blick',
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
                summary: 'Katalog-Eintrag wartet auf Prüfung',
            }
        }
        if (catalog?.state === 'unconfigured') {
            return {
                states: states('done', 'done', 'blocked', 'later'),
                active: 'catalog',
                blockedBy: 'Für diese Instanz ist kein Katalog-Repository eingerichtet - das richtet der Betrieb ein.',
                finished: false,
                summary: 'Paket gemergt - Katalog nicht eingerichtet',
            }
        }
        return {
            states: states('done', 'done', 'current', 'later'),
            active: 'catalog',
            turn: 'you',
            finished: false,
            summary: 'Paket gemergt - jetzt in den Katalog eintragen',
        }
    }

    if (bundleMrState === 'merged') {
        // A newer version on the base branch took its place: nothing left to do for this one.
        if (bundle?.reason === 'other-version' && bundle.onBase && version && isNewerVersion(bundle.onBase.version, version)) {
            return { states: states('done', 'done', 'later', 'later'), finished: true, summary: `Durch Version ${bundle.onBase.version} ersetzt` }
        }
        // Not read (the row says why), so not judged.
        if (!bundle) return { states: states('done', 'done', 'later', 'later'), finished: false, summary: 'Paket gemergt' }
        // Merged, yet missing or different on the base branch: the catalogue step cannot follow, and
        // no button here changes that - sharing again can. Said where it is listed, asked of nobody.
        return {
            states: states('done', 'done', 'blocked', 'later'),
            blockedBy: missingFromBase(bundle, version),
            finished: true,
            summary: 'Paket gemergt, aber nicht im Repository',
        }
    }
    if (bundleMrState === 'closed') {
        return {
            states: states('later', 'later', 'later', 'later'),
            finished: true,
            summary: withdrawn ? 'Zurückgezogen' : 'Merge Request ohne Merge geschlossen',
        }
    }

    return {
        states: states('current', 'later', 'later', 'later'),
        active: 'propose',
        turn: 'you',
        finished: false,
        summary: 'Noch nicht vorgeschlagen',
    }
}

/** "Du bist dran" or who else is; undefined when nobody on either side can move. */
export function turnLabel(progress: ShareProgress): string | undefined {
    // The repository's reviewers decide on a removal, as they did on the merge.
    if (progress.removal === 'pending') return STAGES.find((stage) => stage.key === 'review')?.who
    if (!progress.active || !progress.turn) return undefined
    if (progress.turn === 'you') return 'Du bist dran'
    return STAGES.find((stage) => stage.key === progress.active)?.who
}
