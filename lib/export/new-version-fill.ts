import { useCaseSlugPattern } from '@/lib/catalog/use-case-id'
import { bundleBranch, exportConfig, exportReadiness, packageDir, removalBranch, SHARING_NOT_SET_UP, thisInstance } from '@/lib/export/config'
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
}

const VERSION = /^\d+\.\d+\.\d+$/

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
        const steckbrief = steckbriefFromManifest(manifest, { full: origin === 'this', ...(origin === 'other' ? { elsewhere: true } : {}), ...(domain ? { domain } : {}) })
        if (typeof steckbrief === 'string') return { status: 'invalid', detail: steckbrief }
        return { status: 'ok', steckbrief: { ...steckbrief, from: version, targetKey: target.key } }
    } catch (error) {
        if (error instanceof GitLabError) return { status: 'error', detail: gitlabMessage(error) }
        throw error
    }
}
