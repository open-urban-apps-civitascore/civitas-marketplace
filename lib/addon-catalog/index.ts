import { getAddons } from '@/lib/catalog/source'
import { parseCatalogAddon, type ParsedAddon } from './listing'

export type {
    AddonCuration,
    AddonInstallSpec,
    AddonListing,
    AddonPackageRef,
    ParsedAddon,
} from './listing'

/**
 * Add-ons are catalogue entries like use cases, but they install along a
 * completely different path. A use case becomes data inside a running platform
 * (import endpoint, user token, immediate effect). An add-on is a new
 * deployable component of the instance itself, and CIVITAS installs those
 * through the deployment repository — so the marketplace cannot install one. It
 * can only PROPOSE the change; an operator reviews and applies it.
 *
 * The rows come from the same repo-list as everything else, so there is one
 * catalogue, one fetch and one freshness state for the whole app.
 */
export async function listAddons(): Promise<{ addons: ParsedAddon[]; skipped: number }> {
    const rows = await getAddons()
    const addons = rows
        .map(parseCatalogAddon)
        .filter((entry): entry is ParsedAddon => entry !== null)
    return { addons, skipped: rows.length - addons.length }
}

export async function findAddonListing(id: string): Promise<ParsedAddon | undefined> {
    const { addons } = await listAddons()
    return addons.find((entry) => entry.listing.id === id)
}
