'use server'

import { findAddonListing, type AddonListing } from '@/lib/addon-catalog'
import { fetchAddonPackage, PackageFetchError } from '@/lib/addon-catalog/package-source'
import {
    composeAddonInstall,
    pullRequestBody,
    pullRequestTitle,
    registerComponent,
    type InstallCandidate,
} from '@/lib/deployment-repo/compose'
import {
    deploymentRepoConfig,
    environmentFilePath,
    forgeReadiness,
} from '@/lib/deployment-repo/config'
import { ForgeError, openPullRequest, readFile } from '@/lib/deployment-repo/github'
import { requireSession } from '@/lib/session'

export interface AddonInstallResult {
    status: 'proposed' | 'already-open' | 'already-registered' | 'unconfigured' | 'error'
    detail: string
    /** Set for 'proposed' and 'already-open': where a human reviews the change. */
    prUrl?: string
}

/** Human-readable provenance of the package, for the pull-request body. */
function provenanceOf(listing: AddonListing): string | undefined {
    const source = listing.install?.source
    if (!source) return undefined
    const { project, ref, path } = source
    const location = path === '.' ? '' : ` (${path})`
    return `\`${project}\`${location} at \`${ref}\``
}

/**
 * Resolves the deployment package: fetched from the maintainer's repository at
 * the pinned version. The marketplace never stores a copy, so what lands in the
 * pull request is what the maintainer published at that version.
 */
async function resolveCandidate(listing: AddonListing): Promise<InstallCandidate> {
    const install = listing.install
    if (!install) {
        throw new PackageFetchError('Diese Listung enthält keine Installationsangaben.', 400)
    }

    return {
        componentName: install.componentName,
        subdomain: install.subdomain,
        displayName: listing.displayName,
        description: listing.description ?? listing.summary,
        publisher: listing.publisher,
        license: listing.license,
        version:
            install.source.refType === 'tag'
                ? install.source.ref
                : install.source.ref.slice(0, 7),
        files: await fetchAddonPackage(install.source),
    }
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
    if (typeof entryId !== 'string') {
        return { status: 'error', detail: 'Kein Katalog-Eintrag angegeben.' }
    }

    const entry = await findAddonListing(entryId)
    if (!entry) {
        return { status: 'error', detail: `Unbekannter Katalog-Eintrag: ${entryId}` }
    }

    const { listing, missingForInstall } = entry
    const install = listing.install
    if (!install) {
        return {
            status: 'error',
            detail:
                'Diese Listung sagt noch nicht, wie das Add-on installiert wird. Es fehlt: ' +
                (missingForInstall.join('; ') || 'die Installationsangaben') + '.',
        }
    }

    // A deprecated entry stays visible so instances that already run it learn
    // why — but proposing a fresh install of something the catalogue has
    // withdrawn would work against exactly that.
    if (listing.deprecated) {
        return {
            status: 'error',
            detail:
                `„${listing.displayName}" ist im Katalog als veraltet markiert: ${listing.deprecated.reason}` +
                (listing.deprecated.successorId
                    ? ` Empfohlener Nachfolger: ${listing.deprecated.successorId}.`
                    : ''),
        }
    }

    const config = deploymentRepoConfig()

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

    try {
        // Decide whether there is anything to do BEFORE downloading a package:
        // the registration check is one request, the package is dozens, and an
        // add-on that is already registered needs none of them.
        const registrationPath = environmentFilePath(config)
        const current = await readFile(config, registrationPath)
        const registration = registerComponent(current, install)

        if (registration.status === 'already-registered') {
            return {
                status: 'already-registered',
                detail: `„${install.componentName}" steht bereits in der Komponentenliste von ${config.environment}.`,
            }
        }
        if (registration.status === 'no-component-list') {
            return {
                status: 'error',
                detail:
                    `${registrationPath} enthält keine components-Liste. ` +
                    `Diese Umgebung erbt die Standardliste — sie muss einmalig ausgeschrieben werden.`,
            }
        }

        const candidate = await resolveCandidate(listing)
        const change = composeAddonInstall(candidate, config)

        const result = await openPullRequest(config, {
            branch: change.branch,
            title: pullRequestTitle(candidate),
            body: pullRequestBody(
                candidate,
                change,
                registration.line,
                session.user?.name ?? session.user?.email ?? 'unbekannt',
                provenanceOf(listing),
            ),
            files: {
                ...change.files,
                [change.registrationPath]: { content: registration.content, encoding: 'utf8' },
            },
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
        if (error instanceof PackageFetchError) {
            return {
                status: 'error',
                detail: `Das Deployment-Paket konnte nicht geladen werden: ${error.message}`,
            }
        }
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
