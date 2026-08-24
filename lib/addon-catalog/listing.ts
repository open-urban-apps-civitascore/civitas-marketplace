/**
 * Normalises one add-on row of the repo-list into what the pages need.
 *
 * The row speaks the catalogue's established vocabulary (name, author,
 * compatibility, deploymentRef) plus the fields an install needs: a pinned
 * ref on the deployment reference, the component name and subdomain, and the
 * curation verdict. Older rows carry none of the latter — they are listed all
 * the same, with `missingForInstall` naming what a maintainer would have to
 * add. Hiding them would teach nobody what is missing.
 */
export interface AddonListing {
    id: string
    displayName: string
    /** One sentence, written for a commune. */
    summary: string
    description?: string
    categories: string[]
    /** Who publishes and maintains the add-on integration. */
    publisher: string
    /** The third-party tool the add-on packages, when it wraps one. */
    wrappedTool?: { name: string; homepage?: string; license?: string }
    /** Licence of the integration itself — distinct from the wrapped tool's. */
    license?: string
    links: { documentation?: string; issues?: string }
    compatibleCoreVersions: string[]
    /** What the add-on needs from the platform, e.g. KEYCLOAK, APISIX_INGRESS. */
    platformNeeds: string[]
    /** Absent when the row carries no review information. */
    curation?: AddonCuration
    /** Set when the catalogue has withdrawn the entry but kept it visible. */
    deprecated?: { reason: string; successorId?: string }
    /** Present only when the row carries everything an install proposal needs. */
    install?: AddonInstallSpec
}

/**
 * The store's one graded trust signal. Assigned by review in the catalogue
 * repository, revocable, with published criteria — never self-declared.
 */
export interface AddonCuration {
    tier: 'experimental' | 'community' | 'verified'
    reviewedBy: string
    reviewedAt: string
    notes?: string
}

export interface AddonInstallSpec {
    /**
     * Folder name under `deployment/addons/` AND the exact string in the
     * environment's `components` list — helmfile connects the two.
     */
    componentName: string
    /** Where it becomes reachable, as `<subdomain>.<instance domain>`. */
    subdomain: string
    /** Where the deployment package is fetched from when a proposal is composed. */
    source: AddonPackageRef
}

export interface AddonPackageRef {
    /** Full project path on the forge, e.g. `group/subgroup/project`. */
    project: string
    /** An immutable pin: a tag or a commit hash, never a branch. */
    ref: string
    refType: 'tag' | 'commit'
    /** Folder inside the project holding the package; `.` for the root. */
    path: string
}

export interface ParsedAddon {
    listing: AddonListing
    /**
     * Plain-language list of what this row would still need before the
     * marketplace could propose an install. Empty when `listing.install` is set.
     */
    missingForInstall: string[]
}

/** A version tag or a commit hash — anything else is mutable. */
const IMMUTABLE_REF = /^(v?\d+(\.\d+)*([-.][0-9A-Za-z][0-9A-Za-z.-]*)?|[0-9a-f]{7,40})$/
const BRANCH_LIKE = new Set(['main', 'master', 'develop', 'trunk', 'HEAD'])
/**
 * Component names the deployment repository ships itself. Helmfile prefers
 * `deployment/addons/<name>/` over `components/<name>/`, so an add-on carrying
 * one of these names would REPLACE a platform component. The catalogue's CI
 * refuses such a row, but the catalogue URL is per-instance configuration —
 * the side that acts on the value has to check it too.
 */
const CORE_COMPONENTS = new Set([
    'apisix', 'authz', 'config-adapters', 'etcd', 'frost', 'geoserver', 'kafka',
    'keycloak', 'networkpolicies', 'nifi', 'portal', 'postgres', 'prepare',
    'runtime-policies', 'secrets', 'superset', 'valkey',
])
const TIERS = new Set(['experimental', 'community', 'verified'])

function str(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function strList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : []
}

function record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {}
}

function parseCuration(raw: unknown): AddonCuration | undefined {
    const value = record(raw)
    const tier = str(value.tier)
    const reviewedBy = str(value.reviewedBy)
    const reviewedAt = str(value.reviewedAt)
    if (!tier || !TIERS.has(tier) || !reviewedBy || !reviewedAt) return undefined
    return { tier: tier as AddonCuration['tier'], reviewedBy, reviewedAt, notes: str(value.notes) }
}

/**
 * The package fetcher speaks GitLab's API, so a repository URL is only usable
 * when it points there; the project path is derived rather than duplicated in
 * the row.
 */
function gitlabProject(url: string | undefined): string | undefined {
    if (!url) return undefined
    try {
        const parsed = new URL(url)
        if (parsed.hostname !== 'gitlab.com') return undefined
        const path = parsed.pathname.replace(/^\/+|\/+$/g, '')
        return path || undefined
    } catch {
        return undefined
    }
}

/**
 * Returns `null` only when the row has no usable identity — one broken record
 * must not take the whole catalogue down, so the caller counts skips instead.
 */
export function parseCatalogAddon(raw: unknown): ParsedAddon | null {
    const entry = record(raw)

    const id = str(entry.id)
    const displayName = str(entry.name)
    const summary = str(entry.description)
    if (!id || !displayName || !summary) return null

    const licenses = record(entry.licenses)
    const wrapped = record(entry.wrappedTool)
    const wrappedName = str(wrapped.name)
    const deprecated = record(entry.deprecated)
    const deprecatedReason = str(deprecated.reason)

    const compatibility = Array.isArray(entry.compatibility) ? entry.compatibility : []

    const listing: AddonListing = {
        id,
        displayName,
        summary,
        description: str(entry.details),
        categories: strList(entry.categories),
        publisher: str(entry.author) ?? 'unbekannt',
        wrappedTool: wrappedName
            ? {
                  name: wrappedName,
                  homepage: str(wrapped.homepage),
                  license: str(licenses.tool),
              }
            : undefined,
        license: str(licenses.addon),
        links: { documentation: str(entry.documentation) },
        compatibleCoreVersions: Array.from(
            new Set(
                compatibility
                    .map((item) => str(record(item).coreVersion))
                    .filter((version): version is string => Boolean(version)),
            ),
        ).sort(),
        platformNeeds: strList(entry.requiredCapabilities),
        curation: parseCuration(entry.curation),
        deprecated: deprecatedReason
            ? { reason: deprecatedReason, successorId: str(deprecated.successorId) }
            : undefined,
    }

    const install = record(entry.install)
    const deployment = record(entry.deploymentRef)
    const componentName = str(install.componentName)
    const subdomain = str(install.subdomain)
    const project = gitlabProject(str(deployment.url))
    const path = str(deployment.path) ?? '.'
    const ref = str(deployment.ref)
    const refType = str(deployment.refType)

    const missingForInstall: string[] = []
    if (!componentName) {
        missingForInstall.push('Komponentenname für die Deployment-Konfiguration')
    } else if (CORE_COMPONENTS.has(componentName)) {
        missingForInstall.push(
            `Eigener Komponentenname — „${componentName}" gehört der Plattform und würde deren ` +
                `Komponente ersetzen`,
        )
    }
    if (!subdomain) missingForInstall.push('Subdomain, unter der das Add-on erreichbar wird')
    if (!project) missingForInstall.push('Auf GitLab gehostetes Repository mit dem Paket')
    if (!ref) {
        missingForInstall.push('Feste Version (Tag oder Commit) des Deployment-Pakets')
    } else if (BRANCH_LIKE.has(ref) || !IMMUTABLE_REF.test(ref)) {
        missingForInstall.push(`Unveränderliche Version — „${ref}" kann sich jederzeit ändern`)
    }

    if (!listing.curation) {
        missingForInstall.push('Kuratierungsentscheidung (Stufe, Prüfer, Datum)')
    }

    if (missingForInstall.length === 0) {
        listing.install = {
            componentName: componentName!,
            subdomain: subdomain!,
            source: {
                project: project!,
                ref: ref!,
                refType: refType === 'commit' ? 'commit' : 'tag',
                path,
            },
        }
    }

    return { listing, missingForInstall }
}
