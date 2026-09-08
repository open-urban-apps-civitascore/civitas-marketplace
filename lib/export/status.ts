import { isListed } from '@/lib/export/catalog-entry'
import { bundleBranch, catalogBranch, packageDir, type CatalogRepo, type ExportTarget } from '@/lib/export/config'
import {
    branchHead,
    findMergeRequests,
    getProject,
    parseProjectUrl,
    readFile,
    type GitLabClient,
} from '@/lib/export/gitlab'

/**
 * Where an export stands, read fresh from GitLab every time — no marketplace
 * bookkeeping. The two steps (bundle merge request, catalogue entry) each
 * have a state, and the catalogue step is only offered once the bundle is on
 * the target's base branch: the pin may point at nothing but a commit that
 * exists there.
 */

export interface BundleStatus {
    state: 'none' | 'mr-open' | 'on-base'
    mrUrl?: string
    /** Base-branch head the package was verified at — the commit a catalogue entry pins. */
    sha?: string
    detail?: string
}

export interface CatalogStatus {
    state: 'unconfigured' | 'none' | 'mr-open' | 'listed'
    mrUrl?: string
}

export async function readBundleStatus(
    client: GitLabClient,
    target: ExportTarget,
    slug: string,
    version: string,
    expectedId: string,
): Promise<BundleStatus> {
    const project = await getProject(client, parseProjectUrl(target.url).projectPath)
    const branch = bundleBranch(slug, version)
    const open = (await findMergeRequests(client, project.id, branch)).find((mr) => mr.state === 'opened')
    if (open) return { state: 'mr-open', mrUrl: open.web_url }

    const head = await branchHead(client, project.id, target.baseBranch)
    if (!head) return { state: 'none', detail: `Branch ${target.baseBranch} existiert nicht in ${target.url}` }
    const manifestRaw = await readFile(client, project.id, `${packageDir(target, slug)}/core-ir/manifest.json`, head)
    if (!manifestRaw) return { state: 'none' }
    try {
        const manifest = JSON.parse(manifestRaw) as { id?: unknown; version?: unknown }
        if (manifest.id === expectedId && manifest.version === version) {
            return { state: 'on-base', sha: head }
        }
        return {
            state: 'none',
            detail: `Auf ${target.baseBranch} liegt ${String(manifest.id)} ${String(manifest.version)} — nicht ${expectedId} ${version}`,
        }
    } catch {
        return { state: 'none', detail: 'manifest.json auf dem Basisbranch ist kein gültiges JSON' }
    }
}

export async function readCatalogStatus(
    client: GitLabClient,
    catalog: CatalogRepo | undefined,
    slug: string,
    version: string,
    id: string,
): Promise<CatalogStatus> {
    if (!catalog) return { state: 'unconfigured' }
    const project = await getProject(client, parseProjectUrl(catalog.url).projectPath)
    const open = (await findMergeRequests(client, project.id, catalogBranch(slug, version))).find(
        (mr) => mr.state === 'opened',
    )
    if (open) return { state: 'mr-open', mrUrl: open.web_url }
    const index = await readFile(client, project.id, 'index.json', catalog.baseBranch)
    if (index && isListed(index, id, version)) return { state: 'listed' }
    return { state: 'none' }
}
