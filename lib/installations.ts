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
