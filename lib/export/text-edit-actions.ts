'use server'

import { applyTextEdit, type EntryTexts } from '@/lib/export/catalog-entry'
import { exportConfig, exportReadiness, SHARING_NOT_SET_UP, textBranch, type ExportConfig } from '@/lib/export/config'
import {
    branchHead,
    clientFor,
    currentUser,
    findMergeRequests,
    getProject,
    GitLabError,
    gitlabMessage,
    openMergeRequest,
    parseProjectUrl,
    readFile,
    withdrawMergeRequest,
    type GitLabClient,
    type GitLabProject,
} from '@/lib/export/gitlab'
import { withdrawalMark } from '@/lib/export/merge-request-text'
import { parseExportMetadata, parseKeywords } from '@/lib/export/metadata'
import { readTextEditFill } from '@/lib/export/new-version-fill'
import { SHARE_READS } from '@/lib/export/share-cache'
import { fetchShareRight, proposerName, shareRefusal } from '@/lib/export/share-permission'
import { mergeRequestRef } from '@/lib/export/share-state'
import { textChanges, textDraftOf, textReading, type TextEditRef } from '@/lib/export/text-edit'
import { requireSession } from '@/lib/session'
import { catalogEntryPath } from '@/lib/use-case-catalog/path'

export interface TextEditResult {
    status: 'ok' | 'already-open' | 'unchanged' | 'invalid' | 'unconfigured' | 'forbidden' | 'error'
    detail: string
    mrUrl?: string
}

function parseTexts(data: FormData): EntryTexts | string {
    const text = (key: string) => {
        const value = data.get(key)
        return typeof value === 'string' ? value.trim() : ''
    }
    const displayName = text('displayName')
    if (!displayName) return 'Name im Katalog fehlt.'
    const description = text('description')
    if (!description) return 'Kurzbeschreibung fehlt.'
    const metadata = parseExportMetadata(text('catalogMetadata'))
    if (metadata.data === undefined) return metadata.error
    return { displayName, description, keywords: parseKeywords(text('keywords')), metadata: metadata.data }
}

interface Place {
    config: ExportConfig & { catalog: NonNullable<ExportConfig['catalog']> }
    client: GitLabClient
    project: GitLabProject
    requestedBy: string
}

/** A server action answers any caller, so every one asks again: session, right, and that this instance shared the entry. */
async function placeOf(ref: TextEditRef): Promise<(Place & { id: string; before: ReturnType<typeof textDraftOf> }) | TextEditResult> {
    const session = await requireSession()
    const refusal = shareRefusal(await fetchShareRight())
    if (refusal) return { status: 'forbidden', detail: refusal }
    const config = exportConfig()
    if (exportReadiness(config) !== 'ready' || !config.catalog) return { status: 'unconfigured', detail: SHARING_NOT_SET_UP }
    const fill = await readTextEditFill(ref.targetKey, ref.slug, ref.version)
    if ('refusal' in fill) return { status: 'invalid', detail: fill.refusal }
    const client: GitLabClient = { ...clientFor(config.catalog.url, config.token as string), cache: SHARE_READS, acting: true }
    const project = await getProject(client, parseProjectUrl(config.catalog.url).projectPath)
    return {
        config: { ...config, catalog: config.catalog },
        client,
        project,
        requestedBy: proposerName(session.user),
        id: fill.id,
        before: textDraftOf(fill.steckbrief),
    }
}

async function answering(work: () => Promise<TextEditResult>): Promise<TextEditResult> {
    try {
        return await work()
    } catch (error) {
        if (error instanceof GitLabError) return { status: 'error', detail: gitlabMessage(error) }
        throw error
    }
}

function refOf(data: FormData): TextEditRef {
    const text = (key: string) => {
        const value = data.get(key)
        return typeof value === 'string' ? value : ''
    }
    return { targetKey: text('targetKey'), slug: text('slug'), version: text('version') }
}

export async function proposeTextEdit(data: FormData): Promise<TextEditResult> {
    return answering(async () => {
        const ref = refOf(data)
        const place = await placeOf(ref)
        if ('status' in place) return place
        const texts = parseTexts(data)
        if (typeof texts === 'string') return { status: 'invalid', detail: texts }

        const { config, client, project, requestedBy, id, before } = place
        if (data.get('basedOn') !== textReading(before)) {
            return { status: 'invalid', detail: 'Die Texte im Katalog haben sich geändert, seit du dieses Formular geöffnet hast. Bitte lade die Seite neu - sonst würdest du die neuen Texte überschreiben.' }
        }
        const head = await branchHead(client, project.id, config.catalog.baseBranch)
        const index = head && (await readFile(client, project.id, 'index.json', head))
        if (!index) return { status: 'error', detail: 'Der Katalog ist gerade nicht lesbar. Bitte dem Betrieb melden.' }
        const edit = applyTextEdit(index, id, ref.version, texts)
        if (edit.status === 'not-listed') return { status: 'invalid', detail: `Version ${ref.version} steht gerade nicht mehr im Katalog.` }
        if (edit.status === 'unchanged') return { status: 'unchanged', detail: 'Der Katalog zeigt schon genau diese Texte.' }

        const changed = textChanges(before, textDraftOf({ ...texts, keywords: texts.keywords.join(', ') })).map((change) => change.label)
        const outcome = await openMergeRequest(client, {
            upstream: project,
            baseBranch: config.catalog.baseBranch,
            branch: textBranch(catalogEntryPath(id).publisher, ref.slug, ref.version),
            title: `Update texts: ${texts.displayName} ${ref.version}`,
            description: [
                `Proposed by the Open Urban Apps marketplace on behalf of **${requestedBy}**.`,
                '',
                `Changes only the texts of \`${id}\` in \`useCases\`, version ${ref.version}. The pin, licence, publisher and review stay as they are.`,
                '',
                `Changed: ${changed.join(', ') || 'see the diff'}.`,
                '',
                `Index version bumped to ${edit.indexVersion}.`,
                '',
                'Check: `python3 ci/validate-index.py`',
            ].join('\n'),
            files: { 'index.json': edit.content },
            existingPaths: new Set(['index.json']),
            replacesClosed: true,
            startSha: head,
        })
        if (outcome.status === 'already-open') {
            return { status: 'already-open', detail: `Für diese Version ist schon eine Textänderung in Prüfung (Vorschlag !${outcome.iid}). Zieh sie zurück, wenn du etwas anderes vorschlagen möchtest.`, mrUrl: outcome.url }
        }
        return {
            status: 'ok',
            detail: `Textänderung vorgeschlagen (Vorschlag !${outcome.iid}). Bis das Katalog-Team sie annimmt, zeigt der Katalog den bisherigen Text.`,
            mrUrl: outcome.url,
        }
    })
}

export async function withdrawTextEdit(data: FormData): Promise<TextEditResult> {
    return answering(async () => {
        const ref = refOf(data)
        const place = await placeOf(ref)
        if ('status' in place) return place
        const { client, project, requestedBy, id } = place
        const [requests, bot] = await Promise.all([
            findMergeRequests(client, project.id, textBranch(catalogEntryPath(id).publisher, ref.slug, ref.version)),
            currentUser(client),
        ])
        const open = requests.find((mr) => mr.state === 'opened' && mr.author?.id === bot.id)
        if (!open) return { status: 'unchanged', detail: 'Diese Textänderung ist nicht mehr offen.' }
        await withdrawMergeRequest(client, project.id, open, {
            note: `Withdrawn through the Open Urban Apps marketplace on behalf of **${requestedBy}**.`,
            mark: withdrawalMark(requestedBy, new Date()),
        })
        return { status: 'ok', detail: `Textänderung zurückgezogen (${mergeRequestRef(open.web_url) ?? `Vorschlag !${open.iid}`}). Der Katalog zeigt weiter den bisherigen Text.` }
    })
}
