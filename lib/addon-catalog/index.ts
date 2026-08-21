import { fetchAddonCatalog } from './source'
import type { ParsedAddon } from './listing'

export type {
    AddonCuration,
    AddonInstallSpec,
    AddonListing,
    AddonPackageRef,
    ParsedAddon,
} from './listing'
export type { AddonCatalogResult, CatalogState } from './source'

/**
 * Add-ons are catalogue entries like use cases, but they install along a
 * completely different path. A use case becomes data inside a running platform
 * (import endpoint, user token, immediate effect). An add-on is a new
 * deployable component of the instance itself, and CIVITAS installs those
 * through the deployment repository — so the marketplace cannot install one. It
 * can only PROPOSE the change; an operator reviews and applies it.
 */
export { fetchAddonCatalog as listAddons }

export async function findAddonListing(id: string): Promise<ParsedAddon | undefined> {
    const { addons } = await fetchAddonCatalog()
    return addons.find((entry) => entry.listing.id === id)
}
