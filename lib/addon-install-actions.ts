'use server'

import { findAddonEntry } from '@/lib/addon-catalog'
import {
    composeAddonInstall,
    pullRequestBody,
    pullRequestTitle,
    registerComponent,
} from '@/lib/deployment-repo/compose'
import { deploymentRepoConfig, forgeReadiness } from '@/lib/deployment-repo/config'
import { ForgeError, openPullRequest, readFile } from '@/lib/deployment-repo/github'
import { requireSession } from '@/lib/session'

export interface AddonInstallResult {
    status: 'proposed' | 'already-open' | 'already-registered' | 'unconfigured' | 'error'
    detail: string
    /** Set for 'proposed' and 'already-open': where a human reviews the change. */
    prUrl?: string
}

/**
 * Proposes an add-on install as a pull request against the instance's
 * deployment repository.
 *
 * Deliberately NOT called "install": an add-on becomes a new deployable
 * component of the instance, and only the operator can put one there. This
 * action goes as far as the marketplace legitimately can — it writes a
 * reviewable change and stops. Merging and applying stay with a human.
 *
 * The marketplace authenticates with its own credential, so the person
 * clicking needs no forge account; they are named in the pull request instead.
 */
export async function proposeAddonInstall(
    _prev: AddonInstallResult | null,
    formData: FormData,
): Promise<AddonInstallResult> {
    const session = await requireSession()

    const entryId = formData.get('entryId')
    const entry = typeof entryId === 'string' ? findAddonEntry(entryId) : undefined
    if (!entry) {
        return { status: 'error', detail: `Unbekannter Katalog-Eintrag: ${String(entryId)}` }
    }

    const config = deploymentRepoConfig()
    const { manifest } = entry

    // The readiness states are explained on the page itself; repeating them here
    // would only restate what the user is already looking at.
    const readiness = forgeReadiness(config)
    if (readiness !== 'ready') {
        return {
            status: 'unconfigured',
            detail:
                readiness === 'missing-repo'
                    ? 'Kein Deployment-Repository hinterlegt — die Änderung lässt sich nur manuell übernehmen.'
                    : 'Noch kein Zugang zum Deployment-Repository — die Änderung lässt sich nur manuell übernehmen.',
        }
    }

    const change = composeAddonInstall(entry, config)

    try {
        const current = await readFile(config, change.registrationPath)
        const registration = registerComponent(current, manifest)

        if (registration.status === 'already-registered') {
            return {
                status: 'already-registered',
                detail: `„${manifest.componentName}" steht bereits in der Komponentenliste von ${config.environment}.`,
            }
        }
        if (registration.status === 'no-component-list') {
            return {
                status: 'error',
                detail:
                    `${change.registrationPath} enthält keine components-Liste. ` +
                    `Diese Umgebung erbt die Standardliste — sie muss einmalig ausgeschrieben werden.`,
            }
        }

        const result = await openPullRequest(config, {
            branch: change.branch,
            title: pullRequestTitle(entry),
            body: pullRequestBody(
                entry,
                change,
                registration.line,
                session.user?.name ?? session.user?.email ?? 'unbekannt',
            ),
            files: { ...change.files, [change.registrationPath]: registration.content },
        })

        if (result.status === 'already-open') {
            return {
                status: 'already-open',
                detail: `Es liegt bereits ein offener Pull Request (#${result.number}) für dieses Add-on vor.`,
                prUrl: result.url,
            }
        }

        return {
            status: 'proposed',
            detail: `Pull Request #${result.number} erstellt — die Installation übernimmt der Betrieb nach Freigabe.`,
            prUrl: result.url,
        }
    } catch (error) {
        if (error instanceof ForgeError) {
            return { status: 'error', detail: forgeMessage(error, config.repo) }
        }
        throw error
    }
}

function forgeMessage(error: ForgeError, repo: string): string {
    switch (error.status) {
        case 0:
            return `GitHub ist nicht erreichbar: ${error.message}`
        case 401:
            return 'Der hinterlegte Zugang wurde abgelehnt (401) — Token ungültig oder abgelaufen.'
        case 403:
            return 'Keine Schreibrechte (403) — das Konto darf in diesem Repository nichts anlegen.'
        case 404:
            // The most common real cause, and the most misleading status: GitHub
            // hides private repositories behind 404 rather than revealing them.
            return (
                `${repo} nicht gefunden (404). Bei privaten Repositories meldet GitHub das auch, ` +
                `wenn der Token noch nicht freigegeben ist oder keinen Zugriff auf dieses Repository hat.`
            )
        default:
            return `GitHub-Fehler (${error.status}): ${error.message}`
    }
}
