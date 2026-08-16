import helloManifest from './hello-addon/manifest.json'
import { HELLO_ADDON_PACKAGE } from './hello-addon/package'
import type { CatalogManifest } from '@/lib/mock-catalog'

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
 * folder. Everything install-relevant lives in the manifest so that a fetched
 * catalogue entry can carry it unchanged — swapping this mock for the remote
 * GitLab catalogue is then a data-source change, not a shape change.
 */
export interface AddonEntry {
    manifest: AddonManifest
    files: Record<string, string>
}

export const mockAddonCatalog: AddonEntry[] = [
    {
        manifest: helloManifest as AddonManifest,
        files: HELLO_ADDON_PACKAGE,
    },
]

export function findAddonEntry(id: string): AddonEntry | undefined {
    return mockAddonCatalog.find((entry) => entry.manifest.id === id)
}
