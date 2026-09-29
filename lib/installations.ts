import { getAccessToken } from '@/lib/session'

interface InstallationRow {
    /** The id of the package as the install sent it: the catalogue id of the entry. */
    packageId?: string
    uninstalledAt?: string | null
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
        const accessToken = await getAccessToken()

        // Ask for one large page — the default is 20, and a catalogue badge that
        // silently stops working after the 21st install would be a nasty bug.
        const res = await fetch(
            `${process.env.API_BASE_URL}:${process.env.API_PORT}/v1/installations?size=200`,
            {
                headers: { Authorization: `Bearer ${accessToken}` },
                cache: 'no-store',
            },
        )
        if (!res.ok) return new Set()

        const page = (await res.json()) as { content?: InstallationRow[] }
        return new Set(
            (page.content ?? [])
                .filter((row) => !row.uninstalledAt)
                .map((row) => row.packageId)
                .filter((id): id is string => Boolean(id)),
        )
    } catch {
        return new Set()
    }
}
