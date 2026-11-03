/**
 * The release of an installed use case, in the order the platform demands. An install leaves every
 * artifact a draft, and the dataset's release checks that each source of its pipelines is released,
 * and each structure version its flows reach together with its structure. So the chain releases
 * each structure version, each structure, each source, and then stages and releases the dataset.
 * Every step looks first and releases only what is still a draft: the platform refuses to release
 * anything twice, and so a second run goes on where a first one stopped.
 *
 * The release starts a saga that provisions sinks, routes and pipelines. The platform tells how it
 * ended only by clearing `pendingSagaType` on the dataset: a dataset still AVAILABLE and
 * provisioned then had SAGA_COMPLETED, one back at READY had SAGA_FAILED (a failed provisioning
 * reverts the status). `awaitRelease` waits for that, within a time limit, and says which it was.
 * Start and wait are two calls, so the install can set up its demo data while the platform
 * provisions.
 *
 * No session and no fetch of its own: the caller passes the platform's API, so the order and the
 * waiting are tested without a backend.
 */

export interface PlatformAnswer {
    status: number
    statusText: string
    /** The body as text, for the failure message. */
    text: string
}

export interface PlatformApi {
    get(path: string): Promise<PlatformAnswer>
    post(path: string): Promise<PlatformAnswer>
}

/** The step a refusal came at; the dataset's own two are `stage` and `release`. */
export type ReleaseStep = 'version' | 'structure' | 'source' | 'stage' | 'release'

export interface ReleaseTargets {
    dataSetId: string
    /** The structures the install made or reused, by the portal's id. */
    structureIds: string[]
    sourceIds: string[]
}

/** What the chain released itself, for the summary: what was released before is not counted. */
export interface ReleaseCounts {
    versions: number
    structures: number
    sources: number
}

export type ReleaseStart =
    | { state: 'started'; released: ReleaseCounts }
    | { state: 'refused'; released: ReleaseCounts; step: ReleaseStep; answer: PlatformAnswer }

export type SagaOutcome = 'completed' | 'failed' | 'pending'

export interface WaitOptions {
    timeoutMs: number
    intervalMs: number
    sleep: (ms: number) => Promise<void>
    now: () => number
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ok(answer: PlatformAnswer): boolean {
    return answer.status >= 200 && answer.status < 300
}

function body(answer: PlatformAnswer): Record<string, unknown> {
    try {
        const value: unknown = JSON.parse(answer.text)
        return isRecord(value) ? value : {}
    } catch {
        return {}
    }
}

const at = encodeURIComponent

/**
 * Releases what the dataset's release needs, then stages and releases the dataset, which starts
 * the saga. Ends at the first refusal and names its step; nothing is taken back, because nothing is
 * wrong with what was released so far, and the portal can go on from there.
 */
export async function releaseUseCase(api: PlatformApi, targets: ReleaseTargets): Promise<ReleaseStart> {
    const released: ReleaseCounts = { versions: 0, structures: 0, sources: 0 }
    const refused = (step: ReleaseStep, answer: PlatformAnswer): ReleaseStart => ({ state: 'refused', released, step, answer })

    for (const structureId of targets.structureIds) {
        const structure = `/v1/datastructures/${at(structureId)}`
        const listing = await api.get(`${structure}/versions?size=200`)
        if (!ok(listing)) return refused('version', listing)
        const { content } = body(listing)
        for (const version of Array.isArray(content) ? content : []) {
            if (!isRecord(version) || version.dataStructureVersionStatus !== 'DRAFT' || typeof version.id !== 'string') continue
            const answer = await api.post(`${structure}/versions/${at(version.id)}/release`)
            if (!ok(answer)) return refused('version', answer)
            released.versions++
        }
    }
    for (const structureId of targets.structureIds) {
        const structure = `/v1/datastructures/${at(structureId)}`
        const current = await api.get(structure)
        if (!ok(current)) return refused('structure', current)
        if (body(current).dataStructureStatus !== 'DRAFT') continue
        const answer = await api.post(`${structure}/release`)
        if (!ok(answer)) return refused('structure', answer)
        released.structures++
    }
    for (const sourceId of targets.sourceIds) {
        const source = `/v1/datasources/${at(sourceId)}`
        const current = await api.get(source)
        if (!ok(current)) return refused('source', current)
        if (body(current).dataSourceStatus !== 'DRAFT') continue
        const answer = await api.post(`${source}/release`)
        if (!ok(answer)) return refused('source', answer)
        released.sources++
    }

    const dataset = `/v1/datasets/${at(targets.dataSetId)}`
    const current = await api.get(dataset)
    if (!ok(current)) return refused('stage', current)
    let status = body(current).dataSetStatus
    if (status === 'DRAFT') {
        const answer = await api.post(`${dataset}/stage`)
        if (!ok(answer)) return refused('stage', answer)
        status = 'READY'
    }
    // AVAILABLE already: released by an earlier run, whose saga awaitRelease reads.
    if (status === 'READY') {
        const answer = await api.post(`${dataset}/release`)
        if (!ok(answer)) return refused('release', answer)
    }
    return { state: 'started', released }
}

/**
 * Waits until the dataset's saga has ended and tells how: `completed` when the dataset is
 * AVAILABLE and provisioned, `failed` when the platform reverted it, `pending` when the time ran
 * out first. An answer that cannot be read counts as not ended yet.
 */
export async function awaitRelease(api: PlatformApi, dataSetId: string, wait: WaitOptions): Promise<SagaOutcome> {
    const deadline = wait.now() + wait.timeoutMs
    for (;;) {
        const answer = await api.get(`/v1/datasets/${at(dataSetId)}`)
        const dataset = ok(answer) ? body(answer) : undefined
        if (dataset && dataset.dataSetStatus !== undefined && !dataset.pendingSagaType) {
            return dataset.dataSetStatus === 'AVAILABLE' && dataset.provisioned !== false ? 'completed' : 'failed'
        }
        if (wait.now() >= deadline) return 'pending'
        await wait.sleep(wait.intervalMs)
    }
}
