import { assembleCatalogEntry } from '@/lib/catalog/assemble'
import { fetchCatalogEntry } from '@/lib/catalog/bundle'
import {
    findRepoListSummary,
    getRepoListAddons,
    getRepoListMeta,
    getRepoListSummaries,
    repoListUrl,
} from '@/lib/catalog/repo-list'
import type { AddonEntry, CatalogEntry, CatalogMeta, CatalogSummary } from '@/lib/catalog/types'
import { mockPackages } from '@/lib/mock-catalog'

/**
 * The catalogue source switch — the only module pages and actions talk to.
 *
 * Remote mode (REPO_LIST_URL set): catalogue comes from the git-hosted
 * repo-list; package content is fetched from the artifact repos at install
 * time. Mock mode (no REPO_LIST_URL, or MOCK_CATALOG=1 forcing it): the
 * bundled fixtures serve as the catalogue — same shapes, same assembly path,
 * zero network. That keeps local dev and demos working with no configuration
 * and provides the offline fallback for demo days.
 */

function isMockCatalog(): boolean {
    if (process.env.MOCK_CATALOG === '1') return true
    return repoListUrl() === undefined
}

function mockSummaries(type: 'usecase' | 'datastructure'): CatalogSummary[] {
    return mockPackages
        .filter((pkg) => pkg.manifest.type === type)
        .map((pkg) => ({ ...pkg.manifest }))
}

/** Catalogue rows of one type, for the listing pages. */
export async function getCatalogSummaries(
    type: 'usecase' | 'datastructure',
): Promise<CatalogSummary[]> {
    if (isMockCatalog()) return mockSummaries(type)
    return getRepoListSummaries(type)
}

/**
 * Resolves a catalogue id to the full, assembled entry — mock: from the
 * fixture files; remote: fetched from the pinned artifact repo. Returns
 * undefined for unknown ids; integrity failures throw (see bundle.ts).
 */
export async function resolveCatalogEntry(id: string): Promise<CatalogEntry | undefined> {
    if (isMockCatalog()) {
        const pkg = mockPackages.find((candidate) => candidate.manifest.id === id)
        if (!pkg) return undefined
        return assembleCatalogEntry(pkg.manifest, (file) => {
            const content = pkg.files[file]
            if (!content) throw new Error(`mock package ${id} has no fixture file '${file}'`)
            return content
        })
    }

    const summary = await findRepoListSummary(id)
    if (!summary) return undefined
    return (await fetchCatalogEntry(summary)).entry
}

/** Listable add-ons. The fixtures carry none — an empty list is honest here. */
export async function getAddons(): Promise<AddonEntry[]> {
    if (isMockCatalog()) return []
    return getRepoListAddons()
}

/** Freshness of the served catalogue, for the hint on the listing pages. */
export async function getCatalogMeta(): Promise<CatalogMeta> {
    if (isMockCatalog()) {
        return { version: 'fixtures', fetchedAt: new Date(), origin: 'mock', stale: false }
    }
    return getRepoListMeta()
}
