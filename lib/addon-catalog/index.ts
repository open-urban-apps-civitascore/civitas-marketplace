import helloManifest from './hello-addon/manifest.json'
import { HELLO_ADDON_PACKAGE } from './hello-addon/package'
import { fetchAddonCatalog, type AddonCatalogResult } from './source'
import type { AddonListing, ParsedAddon } from './listing'
import type { CatalogManifest } from '@/lib/mock-catalog'

export type {
    AddonCuration,
    AddonInstallSpec,
    AddonListing,
    AddonPackageRef,
    AddonPackageSource,
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
export interface AddonManifest extends CatalogManifest {
    type: 'addon'
    /**
     * The folder name under `deployment/addons/` AND the exact string registered
     * in the environment's `components` list. Helmfile connects the two by
     * checking whether `deployment/addons/<name>/` exists and preferring it over
     * the built-in `components/<name>/` — so the name must never collide with a
     * core component, or the add-on would silently shadow it.
     */
    componentName: string
    /** Where it becomes reachable, as `<subdomain>.<instance domain>`. Must match the package's `default-environment.yaml.gotmpl`. */
    subdomain: string
}

/**
 * Manifest plus the deployment package, keyed by path relative to the add-on's
 * folder — the shape the install composer needs.
 */
export interface AddonEntry {
    manifest: AddonManifest
    files: Record<string, string>
}

const helloEntry: AddonEntry = {
    manifest: helloManifest as AddonManifest,
    files: HELLO_ADDON_PACKAGE,
}

/**
 * The one add-on whose deployment package ships with this app. It exists so the
 * install path stays provable end to end without depending on a third party's
 * repository, and it is marked as such in the UI — it is not a catalogue entry
 * pretending to be curated.
 */
export const bundledAddons: AddonEntry[] = [helloEntry]

function bundledListing(entry: AddonEntry): ParsedAddon {
    const { manifest } = entry
    return {
        listing: {
            id: manifest.id,
            displayName: manifest.displayName,
            summary: manifest.description,
            categories: manifest.keywords,
            publisher: manifest.maintainer,
            license: manifest.license,
            links: {},
            compatibleCoreVersions: [],
            platformNeeds: [],
            // Deliberately no curation: it ships with this app, nobody reviewed
            // it into a catalogue. Claiming a tier here would fake the signal.
            origin: 'bundled',
            install: {
                componentName: manifest.componentName,
                subdomain: manifest.subdomain,
                source: { kind: 'bundled' },
            },
        },
        missingForInstall: [],
    }
}

export interface AddonIndex extends AddonCatalogResult {
    /** Catalogue entries plus the bundled one, in display order. */
    addons: ParsedAddon[]
}

/**
 * Every add-on this instance can show: the curated catalogue first, the bundled
 * example last. Catalogue state (unconfigured, stale, unreachable) is passed
 * through untouched so the page can say what is actually going on instead of
 * rendering an empty grid.
 */
export async function listAddons(): Promise<AddonIndex> {
    const catalog = await fetchAddonCatalog()

    // Once an add-on is in the catalogue, the catalogue entry is the truth: it
    // is curated, versioned and updated without redeploying this app. Dropping
    // the bundled twin keeps ids unique, so the grid cannot render the same
    // add-on twice and lookups cannot disagree about which package is meant.
    const listed = new Set(catalog.addons.map((entry) => entry.listing.id))
    const bundled = bundledAddons
        .map(bundledListing)
        .filter((entry) => !listed.has(entry.listing.id))

    return { ...catalog, addons: [...catalog.addons, ...bundled] }
}

export async function findAddonListing(id: string): Promise<ParsedAddon | undefined> {
    const { addons } = await listAddons()
    return addons.find((entry) => entry.listing.id === id)
}

/** The bundled entry behind a listing, if this add-on ships its package with the app. */
export function findBundledEntry(id: string): AddonEntry | undefined {
    return bundledAddons.find((entry) => entry.manifest.id === id)
}

/** Kept for the install action, which only ever proposes bundled packages today. */
export function findAddonEntry(id: string): AddonEntry | undefined {
    return findBundledEntry(id)
}

/** Compact provenance label for the UI. */
export function originLabel(listing: AddonListing): string {
    return listing.origin === 'catalog' ? 'Aus dem Katalog' : 'Mitgeliefertes Beispiel'
}
