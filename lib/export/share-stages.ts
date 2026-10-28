import { declinedBy, declinedOn, reasonWords, type Decline } from '@/lib/export/declines'
import { verificationLabel } from '@/lib/export/labels'
import type { BundleStatus, CatalogStatus } from '@/lib/export/status'

// The four stages of sharing, in one place so the wizard and the share tabs say the same.
// A "no" never resets a version: the stage stays `declined` and the version is used up.

export type StageKey = 'propose' | 'review' | 'catalog' | 'listing'

/** `current`: the person's own move now; `waiting`: someone else's; `blocked`: see `blockedBy`. */
export type StageState = 'done' | 'current' | 'waiting' | 'blocked' | 'declined' | 'later'

export interface Stage {
    key: StageKey
    title: string
    short: string
    who: string
    turn: 'you' | 'reviewers'
}

export const STAGES: readonly Stage[] = [
    { key: 'propose', title: 'Paket einreichen', short: 'Einreichen', who: 'Du', turn: 'you' },
    { key: 'review', title: 'Paket-Prüfung', short: 'Paket-Prüfung', who: 'Das Katalog-Team', turn: 'reviewers' },
    { key: 'catalog', title: 'Katalog-Eintrag vorschlagen', short: 'Katalog-Eintrag', who: 'Du', turn: 'you' },
    { key: 'listing', title: 'Eintrags-Prüfung', short: 'Eintrags-Prüfung', who: 'Das Katalog-Team', turn: 'reviewers' },
]

export const WAITING_FOR_TEAM = 'Wartet auf das Katalog-Team'

export interface ShareFacts {
    version?: string
    /** GitLab's state of the version's newest merge request; absent when none was opened. */
    bundleMrState?: string
    bundle?: BundleStatus
    catalog?: CatalogStatus
    /** Closed through the marketplace's withdrawal; closed without one is a "no". */
    withdrawn?: boolean
}

/** False whenever either is no plain x.y.z. */
export function isNewerVersion(candidate: string, version: string): boolean {
    const parse = (value: string) => value.match(/^(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number)
    const a = parse(candidate)
    const b = parse(version)
    if (!a || !b) return false
    for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index]
    return false
}

/** "1.0.3" after "1.0.2"; whether that one is free, the caller checks. */
export function nextPatch(version: string): string {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/)
    return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : '1.0.0'
}

export function aboveAll(versions: readonly string[]): string {
    const plain = versions.filter((version) => /^\d+\.\d+\.\d+$/.test(version))
    const highest = plain.reduce<string | undefined>((best, version) => (!best || isNewerVersion(version, best) ? version : best), undefined)
    return highest ? nextPatch(highest) : '1.0.0'
}

export function sentence(text: string): string {
    return /[.!?]$/.test(text) ? text : `${text}.`
}

export function takenOutFact(takenOut: { version: string; reason?: string }): string {
    const reason = takenOut.reason ? ` Grund: ${sentence(takenOut.reason)}` : ''
    return `Das Katalog-Team hat Version ${takenOut.version} aus dem Katalog genommen.${reason}`
}

export function takenOutNotice(takenOut: { version: string; reason?: string }): string {
    return `${takenOutFact(takenOut)} Frag beim Katalog-Team nach, bevor du eine neue Version teilst.`
}

/** Another version taken out means the whole entry is out (`revoked`), which shuts out every version. */
export function takenOutBlocker(takenOut: { version: string } | undefined, version: string | undefined): string {
    return takenOut && version && takenOut.version !== version
        ? 'Herausgenommen ist der ganze Eintrag: auch eine neue Version kommt erst in den Katalog, wenn das Katalog-Team ihn wieder freigibt.'
        : 'Diese Version kommt nicht noch einmal in den Katalog.'
}

export interface DeclinedStage {
    who: string
    reason: string
    next: string
}

/** A close through the marketplace's account is never told as the catalogue team's decision. */
export function declinedStage(key: 'review' | 'listing', decline: Decline, version: string, instead: string = nextPatch(version)): DeclinedStage {
    const who = decline.viaMarketplace
        ? `Über das Marktplatz-Konto - nicht angenommen${declinedOn(decline)}`
        : `${STAGES.find((stage) => stage.key === key)?.who ?? 'Das Katalog-Team'} - nicht angenommen${declinedOn(decline)}`
    const next =
        key === 'review'
            ? `Für die überarbeitete Fassung trag im Steckbrief eine höhere Version ein, zum Beispiel ${instead}.`
            : `Der Eintrag entsteht aus dem angenommenen Paket. Für einen anderen Eintrag trag im Steckbrief eine höhere Version ein, zum Beispiel ${instead} - sie wird wieder geprüft.`
    return { who, reason: reasonWords(decline), next }
}

export function removalDeclinedNotice(decline: Decline): string {
    const said = decline.viaMarketplace ? `Das Entfernen ${declinedBy(decline)}` : `Das Katalog-Team hat das Entfernen${declinedOn(decline)} nicht angenommen`
    return `${said} - das Paket bleibt angenommen.`
}

export function reviewChangeNotice(version: string): string {
    return `Bei der Prüfung von Version ${version} hat das Katalog-Team etwas geändert. Eine neue Version aus dem Datensatz überschreibt das - übernimm die Änderung vorher auf deiner Instanz.`
}

function takenOutSummary(takenOut: { reason?: string } | undefined): string {
    const reason = takenOut?.reason?.replace(/[.!?]+$/, '')
    return reason ? `Aus dem Katalog genommen - ${reason}` : 'Aus dem Katalog genommen'
}

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
    active?: StageKey
    /** Absent when only the operator can help. */
    turn?: 'you' | 'reviewers'
    blockedBy?: string
    /** Nothing the marketplace can move on; a "no" still has `active` and `turn`. */
    finished: boolean
    /** Removal from the repository: outside the four stages, it undoes them. */
    removal?: 'pending' | 'done'
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
        if (catalog?.state === 'declined') {
            return {
                states: states('done', 'done', 'done', 'declined'),
                active: 'listing',
                turn: 'you',
                finished: true,
                summary: 'Paket angenommen, Katalog-Eintrag nicht angenommen',
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
        if (bundle?.reason === 'other-version' && bundle.onBase && version && isNewerVersion(bundle.onBase.version, version)) {
            return { states: states('done', 'done', 'later', 'later'), finished: true, summary: `Durch Version ${bundle.onBase.version} ersetzt` }
        }
        // Not read, so not judged.
        if (!bundle) return { states: states('done', 'done', 'later', 'later'), finished: false, summary: 'Paket angenommen' }
        // Finished although blocked: no button here can change it, only sharing again.
        return {
            states: states('done', 'done', 'blocked', 'later'),
            blockedBy: missingFromBase(bundle, version),
            finished: true,
            summary: 'Paket angenommen, aber nicht mehr im Ablageort',
        }
    }
    if (bundle?.declined || (bundleMrState === 'closed' && !withdrawn)) {
        return {
            states: states('done', 'declined', 'later', 'later'),
            active: 'review',
            turn: 'you',
            finished: true,
            summary: 'Nicht angenommen',
        }
    }
    if (bundleMrState === 'closed') {
        return { states: states('later', 'later', 'later', 'later'), finished: true, summary: 'Zurückgezogen' }
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
