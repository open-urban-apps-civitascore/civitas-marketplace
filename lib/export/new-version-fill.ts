import { useCaseSlugPattern } from '@/lib/catalog/use-case-id'
import { catalogInputFromManifest, listedRowOf } from '@/lib/export/catalog-entry'
import { bundleBranch, exportConfig, exportReadiness, packageDir, removalBranch, SHARING_NOT_SET_UP, thisInstance, type ExportConfig } from '@/lib/export/config'
import { clientFor, currentUser, findMergeRequests, getProject, GitLabError, gitlabMessage, parseProjectUrl, readFile, type GitLabClient } from '@/lib/export/gitlab'
import { domainOf, readmeSourceOf, shareSourceOf } from '@/lib/export/merge-request-text'
import { steckbriefFromManifest, type FilledSteckbrief } from '@/lib/export/new-version'
import { SHARE_READS } from '@/lib/export/share-cache'
import { instanceMatch } from '@/lib/export/share-tabs'
import { presentRequests } from '@/lib/export/status'

export interface NewVersionFill {
    status: 'ok' | 'missing' | 'invalid' | 'forbidden' | 'unconfigured' | 'error'
    detail?: string
    steckbrief?: FilledSteckbrief
    listedAs?: string
}

export type TextEditFill = { id: string; steckbrief: FilledSteckbrief } | { refusal: string }

const VERSION = /^\d+\.\d+\.\d+$/

async function listedRow({ catalog, token }: ExportConfig, id: string, version: string): Promise<string | undefined> {
    if (!catalog) return undefined
    const client: GitLabClient = { ...clientFor(catalog.url, token as string), cache: SHARE_READS }
    const project = await getProject(client, parseProjectUrl(catalog.url).projectPath)
    const index = await readFile(client, project.id, 'index.json', catalog.baseBranch)
    // Better no form than one that silently brings back the package's old text.
    if (index === undefined) throw new GitLabError('Katalog nicht gefunden', 404)
    return listedRowOf(index, id, version)
}

/** Reads at the proposal's last commit, kept after its branch is gone, so a withdrawn version fills too. */
export async function readNewVersionFill(targetKey: string, slug: string, version: string): Promise<NewVersionFill> {
    const config = exportConfig()
    // Exactly as named, no fallback to the only target: the listing names every package's.
    const target = config.targets.find((candidate) => candidate.key === targetKey)
    if (exportReadiness(config) !== 'ready' || !target) return { status: 'unconfigured', detail: SHARING_NOT_SET_UP }
    if (!useCaseSlugPattern.test(slug) || !VERSION.test(version)) return { status: 'invalid', detail: 'Ungültiger Kurzname oder ungültige Version.' }
    const notShared = `Version ${version} von „${slug}“ ist nicht über diesen Marktplatz geteilt.`
    try {
        const client: GitLabClient = { ...clientFor(target.url, config.token as string), cache: SHARE_READS }
        const [project, bot] = await Promise.all([getProject(client, parseProjectUrl(target.url).projectPath), currentUser(client)])
        const [requests, removals] = await Promise.all([
            findMergeRequests(client, project.id, bundleBranch(slug, version)),
            findMergeRequests(client, project.id, removalBranch(slug, version)),
        ])
        const own = requests.filter((mr) => mr.author?.id === bot.id)
        // The accepted one, unless a removal undid it: then the newest, even a withdrawn one, holds the newer text.
        const present = presentRequests(own, removals)
        const shared = present.find((mr) => mr.state === 'merged') ?? present[0] ?? own[0]
        if (!shared?.sha) return { status: 'missing', detail: notShared }
        const dir = packageDir(target, slug)
        const line = shareSourceOf(shared.description)
        const [manifest, readme] = await Promise.all([
            readFile(client, project.id, `${dir}/core-ir/manifest.json`, shared.sha),
            line ? Promise.resolve(undefined) : readFile(client, project.id, `${dir}/README.md`, shared.sha),
        ])
        if (!manifest) return { status: 'missing', detail: notShared }
        const origin = instanceMatch(line ?? readmeSourceOf(readme), thisInstance())
        const domain = domainOf(shared.description)
        const packaged = catalogInputFromManifest(manifest, { repoUrl: '', path: '', commitSha: '' })
        if (typeof packaged === 'string') return { status: 'invalid', detail: packaged }
        const listed = await listedRow(config, packaged.id, version)
        const steckbrief = steckbriefFromManifest(listed ?? manifest, { full: origin === 'this', ...(origin === 'other' ? { elsewhere: true } : {}), ...(domain ? { domain } : {}) })
        if (typeof steckbrief === 'string') return { status: 'invalid', detail: steckbrief }
        return { status: 'ok', steckbrief: { ...steckbrief, from: version, targetKey: target.key }, ...(listed ? { listedAs: packaged.id } : {}) }
    } catch (error) {
        if (error instanceof GitLabError) return { status: 'error', detail: gitlabMessage(error) }
        throw error
    }
}

/** Only a listed version, and only the instance that shared it: the check behind the form and its action. */
export async function readTextEditFill(targetKey: string, slug: string, version: string): Promise<TextEditFill> {
    const { steckbrief, listedAs, detail } = await readNewVersionFill(targetKey, slug, version)
    if (!steckbrief) return { refusal: detail ?? 'Die Angaben ließen sich nicht lesen.' }
    if (!listedAs) return { refusal: `Version ${version} von „${slug}“ steht gerade nicht im Katalog. Texte lassen sich nur bei einem Eintrag im Katalog ändern.` }
    if (!steckbrief.full) return { refusal: 'Dieses Paket wurde nicht von dieser Instanz geteilt. Seine Texte kann nur die Instanz ändern, die es geteilt hat - oder das Katalog-Team.' }
    return { id: listedAs, steckbrief }
}
