import type { InstallationReceipt } from '@/lib/install-payload'
import {
    activeInstallationOf,
    partitionInstallations,
    readAllInstallations,
} from '@/lib/installation-list'
import { getAccessToken } from '@/lib/session'

interface InstallationRow {
    id: string
    /** The id of the package as the install sent it: the catalogue id of the entry. */
    packageId?: string
    uninstalledAt?: string | null
    /** The dataset the install produced, if any. */
    dataSetId?: string
    dataSetName?: string
}

/** What a page needs to know about the active installation of an entry. */
export interface ActiveInstallation {
    id: string
    dataSetId?: string
}

/**
 * Catalogue ids of the entries this instance has ACTIVELY installed, read from
 * the platform's installations (`GET /v1/installations`). Use-case bundles and
 * single data structures both record one, under the id of their package.
 * Uninstalled installations stay in the record as history but no longer claim
 * the badge: the entry is installable again.
 *
 * Returns an empty set when the endpoint is unreachable or the signed-in role
 * lacks INSTALLATION_READ: a missing badge is a far better failure mode than a
 * catalogue that refuses to install anything.
 */
export async function fetchInstalledCatalogEntryIds(): Promise<Set<string>> {
    try {
        const list = await readAllInstallations<InstallationRow>(await getAccessToken())
        if (!list.ok) return new Set()

        return new Set(
            partitionInstallations(list.rows)
                .active.map((row) => row.packageId)
                .filter((id): id is string => Boolean(id)),
        )
    } catch {
        return new Set()
    }
}

/** What a server action needs to know about one installation. */
export interface InstallationFacts {
    id: string
    packageId?: string
    dataSetId?: string
    dataSetName?: string
    /** False once uninstalled: the record stays as history. */
    active: boolean
}

/**
 * One installation by its id, from the platform's record, read with the
 * caller's token. Actions take the package and the dataset from here and never
 * from the form: a form field can name any dataset, the record names the
 * installation's own. Null when the record cannot be read or has no such row.
 */
export async function fetchInstallationFacts(
    installationId: string,
    accessToken: string,
): Promise<InstallationFacts | null> {
    try {
        const list = await readAllInstallations<InstallationRow>(accessToken)
        if (!list.ok) return null
        const row = list.rows.find((candidate) => candidate.id === installationId)
        if (!row) return null
        return {
            id: row.id,
            ...(row.packageId ? { packageId: row.packageId } : {}),
            ...(row.dataSetId ? { dataSetId: row.dataSetId } : {}),
            ...(row.dataSetName ? { dataSetName: row.dataSetName } : {}),
            active: !row.uninstalledAt,
        }
    } catch {
        return null
    }
}

/**
 * The active installation of one catalogue entry, or null when the entry is
 * not installed. Also null when the list cannot be read, for the reason given
 * above: the page must render without the badge rather than not at all.
 */
export async function fetchActiveInstallation(entryId: string): Promise<ActiveInstallation | null> {
    // Outside the try block: a missing session ends in a redirect, which
    // travels as an exception and must not be mistaken for an unreachable
    // backend.
    const accessToken = await getAccessToken()

    try {
        const list = await readAllInstallations<InstallationRow>(accessToken)
        if (!list.ok) return null

        const row = activeInstallationOf(list.rows, entryId)
        if (!row) return null
        return { id: row.id, ...(row.dataSetId ? { dataSetId: row.dataSetId } : {}) }
    } catch {
        return null
    }
}

/**
 * One installation as the platform recorded it (`GET /v1/installations/{id}`):
 * its dataset and one line per artifact, which is what names a demo stream
 * after the portal's artifacts. Null when it cannot be read: the streams then
 * take their names from the package, which is worse but never a reason to
 * leave demo data switched off.
 */
export async function fetchInstallation(installationId: string): Promise<InstallationReceipt | null> {
    // Outside the try block, for the reason fetchActiveInstallation gives.
    const accessToken = await getAccessToken()

    try {
        const res = await fetch(
            `${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/installations/${encodeURIComponent(installationId)}`,
            { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' },
        )
        if (!res.ok) return null
        return (await res.json()) as InstallationReceipt
    } catch {
        return null
    }
}
