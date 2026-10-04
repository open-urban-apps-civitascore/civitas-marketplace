/**
 * Where an export may propose its package, and with which credential.
 *
 * Per-instance operator configuration, like the deployment repository for
 * add-on installs: the credential belongs to the SERVICE (a bot account on
 * GitLab), never to the person clicking export — nobody using the marketplace
 * needs a forge account. One token serves every target and the catalogue.
 *
 * A target the token cannot push to is still usable: the export then goes
 * through the bot's fork and opens the merge request from there — exactly how
 * outsiders contribute to a public repository they have no rights on. The
 * catalogue repository is the usual case: most instances can read it, few may
 * write to it.
 */

export interface ExportTarget {
    /** Stable key for the form (the repository URL). */
    key: string
    label: string
    /** Project web URL, e.g. https://gitlab.com/civitascore-openurbanapps/civitas-marketplace-catalog */
    url: string
    baseBranch: string
    /** Folder the package directory is created under; '.' for the repository root. */
    pathPrefix: string
}

export interface CatalogRepo {
    url: string
    baseBranch: string
}

export interface ExportConfig {
    targets: ExportTarget[]
    /** Why the target list is empty or unusable, for the page to show verbatim. */
    targetsError?: string
    token?: string
    catalog?: CatalogRepo
}

const RAW_INDEX_URL = /^(https?:\/\/[^/]+\/.+?)\/-\/raw\/([^/]+)\/index\.json$/

/**
 * The catalogue repository is derived from the repo-list URL unless set
 * explicitly: `https://host/group/project/-/raw/<branch>/index.json` names
 * both the project and the branch the entry MR must target.
 */
/** Loosely typed on purpose: tests hand in plain objects, production hands in process.env. */
export type EnvLike = Record<string, string | undefined>

export function catalogRepoFromEnv(env: EnvLike = process.env): CatalogRepo | undefined {
    const explicit = env.CATALOG_REPO_URL?.trim()
    if (explicit) {
        return { url: stripGitSuffix(explicit), baseBranch: env.CATALOG_REPO_BRANCH?.trim() || 'main' }
    }
    const match = env.REPO_LIST_URL?.trim().match(RAW_INDEX_URL)
    if (!match) return undefined
    return { url: match[1], baseBranch: env.CATALOG_REPO_BRANCH?.trim() || match[2] }
}

function stripGitSuffix(url: string): string {
    return url.replace(/\/+$/, '').replace(/\.git$/, '')
}

const SAFE_PREFIX = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Parses EXPORT_TARGET_REPOS, a JSON array of
 * `{ "label", "url", "baseBranch"?, "pathPrefix"? }`. Invalid entries fail the
 * whole list with a message instead of being skipped: a silently dropped
 * target would send someone's package to the wrong repository.
 */
export function parseExportTargets(raw: string | undefined): {
    targets: ExportTarget[]
    error?: string
} {
    if (!raw?.trim()) return { targets: [] }
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch (error) {
        return { targets: [], error: `EXPORT_TARGET_REPOS ist kein gültiges JSON: ${String(error)}` }
    }
    if (!Array.isArray(parsed)) {
        return { targets: [], error: 'EXPORT_TARGET_REPOS muss ein JSON-Array sein' }
    }
    const targets: ExportTarget[] = []
    for (const [index, item] of parsed.entries()) {
        if (typeof item !== 'object' || item === null) {
            return { targets: [], error: `EXPORT_TARGET_REPOS[${index}] ist kein Objekt` }
        }
        const record = item as Record<string, unknown>
        const url = typeof record.url === 'string' ? stripGitSuffix(record.url.trim()) : ''
        if (!/^https:\/\/[^/]+\/.+/.test(url)) {
            return { targets: [], error: `EXPORT_TARGET_REPOS[${index}].url muss eine https-Projekt-URL sein` }
        }
        const label = typeof record.label === 'string' && record.label.trim() ? record.label.trim() : url
        const baseBranch =
            typeof record.baseBranch === 'string' && record.baseBranch.trim()
                ? record.baseBranch.trim()
                : 'main'
        const pathPrefix =
            typeof record.pathPrefix === 'string' && record.pathPrefix.trim()
                ? record.pathPrefix.trim().replace(/^\/+|\/+$/g, '')
                : '.'
        if (pathPrefix !== '.' && !pathPrefix.split('/').every((s) => SAFE_PREFIX.test(s))) {
            return {
                targets: [],
                error: `EXPORT_TARGET_REPOS[${index}].pathPrefix muss ein einfacher relativer Pfad sein`,
            }
        }
        targets.push({ key: url, label, url, baseBranch, pathPrefix })
    }
    return { targets }
}

export function exportConfig(env: EnvLike = process.env): ExportConfig {
    const { targets, error } = parseExportTargets(env.EXPORT_TARGET_REPOS)
    return {
        targets,
        targetsError: error,
        token: env.EXPORT_REPO_TOKEN?.trim() || undefined,
        catalog: catalogRepoFromEnv(env),
    }
}

export type ExportReadiness = 'ready' | 'missing-targets' | 'missing-token'

/** Composing and previewing always works; opening merge requests needs targets and a token. */
export function exportReadiness(config: ExportConfig): ExportReadiness {
    if (config.targets.length === 0) return 'missing-targets'
    if (!config.token) return 'missing-token'
    return 'ready'
}

/** The package directory inside the target repository: `<pathPrefix>/<slug>`, or `<slug>` at the root. */
export function packageDir(target: Pick<ExportTarget, 'pathPrefix'>, slug: string): string {
    return target.pathPrefix === '.' ? slug : `${target.pathPrefix}/${slug}`
}

/** Deterministic, so clicking twice targets the same branch; versioned, so a v2 never collides with an open v1. */
export function bundleBranch(slug: string, version: string): string {
    return `export/${slug}-${version.replace(/[^A-Za-z0-9.-]/g, '-')}`
}

export function catalogBranch(slug: string, version: string): string {
    return `catalog/${slug}-${version.replace(/[^A-Za-z0-9.-]/g, '-')}`
}
