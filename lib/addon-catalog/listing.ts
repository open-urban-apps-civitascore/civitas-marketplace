/**
 * What the marketplace knows about one add-on, independent of where the entry
 * came from.
 *
 * The catalogue (`civitas-addon-catalog`) validates entries in its own CI, so
 * this parser is not a second gatekeeper — but it is reading data over the
 * network, so a malformed entry is skipped rather than allowed to break the
 * page, and an entry missing install data is listed rather than hidden.
 *
 * Listing and installability stay separate questions: being able to show an
 * add-on honestly — "listed, but this entry does not say how to install it" —
 * is more useful than hiding it, and it names what a maintainer has to add.
 */
export interface AddonListing {
    id: string
    displayName: string
    /** One sentence, written for a commune — the catalogue's own text. */
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
    /** Absent when the entry carries no review information. */
    curation?: AddonCuration
    /** Set when the catalogue has withdrawn the entry but kept it visible. */
    deprecated?: { reason: string; successorId?: string }
    /** Present only when the entry carries everything an install proposal needs. */
    install?: AddonInstallSpec
}

/**
 * The store's one graded trust signal. Assigned by review in the catalogue
 * repository, revocable, with published criteria — never self-declared by the
 * add-on.
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
    /** Forge the project lives on. */
    type: 'gitlab'
    /** Full project path, e.g. `group/subgroup/project`. */
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
     * Plain-language list of what this entry would still need before the
     * marketplace could propose an install. Empty when `listing.install` is set.
     */
    missingForInstall: string[]
}

/** A version tag or a commit hash — anything else is mutable. */
const IMMUTABLE_REF = /^(v?\d+(\.\d+)*([-.][0-9A-Za-z][0-9A-Za-z.-]*)?|[0-9a-f]{7,40})$/
const BRANCH_LIKE = new Set(['main', 'master', 'develop', 'trunk', 'HEAD'])
const TIERS = new Set(['experimental', 'community', 'verified'])

function str(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function strList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : []
}

function parseCuration(raw: unknown): AddonCuration | undefined {
    if (typeof raw !== 'object' || raw === null) return undefined
    const value = raw as Record<string, unknown>
    const tier = str(value.tier)
    const reviewedBy = str(value.reviewedBy)
    const reviewedAt = str(value.reviewedAt)
    if (!tier || !TIERS.has(tier) || !reviewedBy || !reviewedAt) return undefined
    return {
        tier: tier as AddonCuration['tier'],
        reviewedBy,
        reviewedAt,
        notes: str(value.notes),
    }
}

/**
 * Normalises one catalogue entry.
 *
 * Returns `null` only when the entry has no usable identity — a single broken
 * record must not take the whole catalogue down with it, so the caller counts
 * and reports skips instead of throwing.
 */
export function parseCatalogAddon(raw: unknown): ParsedAddon | null {
    if (typeof raw !== 'object' || raw === null) return null
    const entry = raw as Record<string, unknown>

    const id = str(entry.id)
    const displayName = str(entry.displayName)
    const summary = str(entry.summary)
    if (!id || !displayName || !summary) return null

    const links = (entry.links ?? {}) as Record<string, unknown>
    const wrapped = (entry.wrappedTool ?? {}) as Record<string, unknown>
    const wrappedName = str(wrapped.name)
    const deprecatedRaw = (entry.deprecated ?? null) as Record<string, unknown> | null
    const deprecatedReason = deprecatedRaw ? str(deprecatedRaw.reason) : undefined

    const listing: AddonListing = {
        id,
        displayName,
        summary,
        description: str(entry.description),
        categories: strList(entry.categories),
        publisher: str(entry.publisher) ?? 'unbekannt',
        wrappedTool: wrappedName
            ? {
                  name: wrappedName,
                  homepage: str(wrapped.homepage),
                  license: str(wrapped.license),
              }
            : undefined,
        license: str(entry.license),
        links: {
            documentation: str(links.documentation),
            issues: str(links.issues),
        },
        compatibleCoreVersions: strList(entry.compatibleCoreVersions),
        platformNeeds: strList(entry.platformNeeds),
        curation: parseCuration(entry.curation),
        deprecated: deprecatedReason
            ? { reason: deprecatedReason, successorId: str(deprecatedRaw?.successorId) }
            : undefined,
    }

    const source = (entry.source ?? {}) as Record<string, unknown>
    const install = (entry.install ?? {}) as Record<string, unknown>

    const componentName = str(install.componentName)
    const subdomain = str(install.subdomain)
    const project = str(source.project)
    const path = str(source.path)
    const ref = str(source.ref)
    const refType = str(source.refType)

    const missingForInstall: string[] = []
    if (!componentName) missingForInstall.push('Komponentenname für die Deployment-Konfiguration')
    if (!subdomain) missingForInstall.push('Subdomain, unter der das Add-on erreichbar wird')
    if (str(source.type) !== 'gitlab') missingForInstall.push('Unterstützte Paketquelle (GitLab)')
    if (!project) missingForInstall.push('Projekt mit dem Deployment-Paket')
    if (!path) missingForInstall.push('Pfad zum Deployment-Paket im Projekt')
    if (!ref) {
        missingForInstall.push('Feste Version (Tag oder Commit) des Deployment-Pakets')
    } else if (BRANCH_LIKE.has(ref) || !IMMUTABLE_REF.test(ref)) {
        missingForInstall.push(
            `Unveränderliche Version — „${ref}" kann sich jederzeit ändern`,
        )
    }

    if (missingForInstall.length === 0) {
        listing.install = {
            componentName: componentName!,
            subdomain: subdomain!,
            source: {
                type: 'gitlab',
                project: project!,
                ref: ref!,
                refType: refType === 'commit' ? 'commit' : 'tag',
                path: path!,
            },
        }
    }

    return { listing, missingForInstall }
}
