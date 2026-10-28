// Operator configuration for sharing: one bot token serves every target and the catalogue.

export interface ExportTarget {
    key: string
    label: string
    url: string
    baseBranch: string
    /** '.' for the repository root. */
    pathPrefix: string
}

export interface CatalogRepo {
    url: string
    baseBranch: string
}

export interface ExportConfig {
    targets: ExportTarget[]
    targetsError?: string
    token?: string
    catalog?: CatalogRepo
}

const RAW_INDEX_URL = /^(https?:\/\/[^/]+\/.+?)\/-\/raw\/([^/]+)\/index\.json$/

export type EnvLike = Record<string, string | undefined>

/** Unless set explicitly, from `REPO_LIST_URL` (`…/<group>/<project>/-/raw/<branch>/index.json`). */
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

/** One bad entry fails the list: skipping it could send a package to the wrong repository. */
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

/** Tells this instance's shares from those of others on the same GitLab account. */
export function thisInstance(env: EnvLike = process.env): string | undefined {
    return env.PORTAL_URL?.trim().replace(/\/+$/, '') || undefined
}

export type ExportReadiness = 'ready' | 'missing-targets' | 'missing-token'

export const SHARING_NOT_SET_UP = 'Teilen ist auf dieser Instanz noch nicht eingerichtet - Ablageort oder GitLab-Zugang fehlen. Das richtet der Betrieb ein.'

export function exportReadiness(config: ExportConfig): ExportReadiness {
    if (config.targets.length === 0) return 'missing-targets'
    if (!config.token) return 'missing-token'
    return 'ready'
}

export function packageDir(target: Pick<ExportTarget, 'pathPrefix'>, slug: string): string {
    return target.pathPrefix === '.' ? slug : `${target.pathPrefix}/${slug}`
}

/** Deterministic, so a second click targets the same branch. */
export function bundleBranch(slug: string, version: string): string {
    return `export/${slug}-${version.replace(/[^A-Za-z0-9.-]/g, '-')}`
}

export function parseBundleBranch(branch: string): { slug: string; version: string } | undefined {
    const match = /^export\/(.+)-(\d+\.\d+\.\d+)$/.exec(branch)
    return match ? { slug: match[1], version: match[2] } : undefined
}

export function catalogBranch(slug: string, version: string): string {
    return `catalog/${slug}-${version.replace(/[^A-Za-z0-9.-]/g, '-')}`
}

export function parseCatalogBranch(branch: string): { slug: string; version: string } | undefined {
    const match = /^catalog\/(.+)-(\d+\.\d+\.\d+)$/.exec(branch)
    return match ? { slug: match[1], version: match[2] } : undefined
}

export function removalBranch(slug: string, version: string): string {
    return `remove/${slug}-${version.replace(/[^A-Za-z0-9.-]/g, '-')}`
}

export function parseRemovalBranch(branch: string): { slug: string; version: string } | undefined {
    const match = /^remove\/(.+)-(\d+\.\d+\.\d+)$/.exec(branch)
    return match ? { slug: match[1], version: match[2] } : undefined
}
