/**
 * Every request to GitLab goes through here: a few at a time, at most
 * `PER_MINUTE` reads a minute, and none at all while GitLab has asked us to
 * wait. Per host, with and without a token apart, as GitLab counts them apart.
 */

const IN_FLIGHT = 4
/** GitLab.com Free allows 100 per account; the rest is left for whoever else uses the token. */
const PER_MINUTE = 80
const MINUTE_MS = 60_000
/** Longer than this a read does not wait, for a slot and room in the minute together: the gateway gives a page 60 s. */
const LONGEST_WAIT_MS = 15_000
const FALLBACK_PAUSE_S = 60
const LONGEST_PAUSE_S = 3600

export class GitLabPausedError extends Error {
    constructor(readonly until: number) {
        super(pauseText(until))
        this.name = 'GitLabPausedError'
    }
}

export function pauseText(until: number, now = Date.now()): string {
    const minutes = Math.max(1, Math.ceil((until - now) / MINUTE_MS))
    return `GitLab bremst gerade - in etwa ${minutes === 1 ? 'einer Minute' : `${minutes} Minuten`} geht es weiter.`
}

interface Gate {
    pausedUntil: number
    /** When the requests of the last minute went out, oldest first. */
    sent: number[]
    running: number
    waiting: (() => void)[]
}

const gates = new Map<string, Gate>()

export function resetGitLabGateForTests(): void {
    gates.clear()
}

function parts(url: string): { host: string; pathname: string } {
    try {
        return new URL(url)
    } catch {
        return { host: url, pathname: url }
    }
}

const hostOf = (url: string) => parts(url).host

const keyOf = (url: string, token: boolean) => `${hostOf(url)}|${token ? 'token' : 'anonymous'}`

function gateFor(url: string, token: boolean): Gate {
    const key = keyOf(url, token)
    let gate = gates.get(key)
    if (!gate) gates.set(key, (gate = { pausedUntil: 0, sent: [], running: 0, waiting: [] }))
    return gate
}

/** Until when GitLab asked to wait, if it still does. */
export function pausedUntil(url: string, token: boolean): number | undefined {
    const until = gates.get(keyOf(url, token))?.pausedUntil
    return until && until > Date.now() ? until : undefined
}

function perMinute(): number {
    const configured = Number(process.env.GITLAB_REQUESTS_PER_MINUTE)
    return Number.isFinite(configured) && configured > 0 ? configured : PER_MINUTE
}

function refuseWhilePaused(gate: Gate): void {
    if (gate.pausedUntil > Date.now()) throw new GitLabPausedError(gate.pausedUntil)
}

async function takeSlot(gate: Gate, deadline: number): Promise<void> {
    if (gate.running < IN_FLIGHT) {
        gate.running++
        return
    }
    // A released slot is handed over, so `running` stays.
    await new Promise<void>((resolve, reject) => {
        const timer = Number.isFinite(deadline)
            ? setTimeout(() => {
                  gate.waiting.splice(gate.waiting.indexOf(handOver), 1)
                  reject(new GitLabPausedError(Date.now() + MINUTE_MS))
              }, deadline - Date.now())
            : undefined
        const handOver = () => {
            clearTimeout(timer)
            resolve()
        }
        gate.waiting.push(handOver)
    })
}

function releaseSlot(gate: Gate): void {
    const next = gate.waiting.shift()
    if (next) next()
    else gate.running--
}

function forgetOlderThanMinute(gate: Gate, now: number): void {
    while (gate.sent.length && gate.sent[0] <= now - MINUTE_MS) gate.sent.shift()
}

/** Counts the request in the minute; checked and counted in one step, so two cannot take the last place. */
async function placeInMinute(gate: Gate, deadline: number, acting: boolean): Promise<void> {
    for (;;) {
        // Also after waiting: a request that ended meanwhile may have been refused.
        refuseWhilePaused(gate)
        const now = Date.now()
        forgetOlderThanMinute(gate, now)
        if (acting || gate.sent.length < perMinute()) {
            gate.sent.push(now)
            return
        }
        const free = gate.sent[0] + MINUTE_MS
        if (free > deadline) throw new GitLabPausedError(free)
        await new Promise((resolve) => setTimeout(resolve, free - now))
    }
}

function pauseSeconds(headers: Headers): number {
    const retryAfter = headers.get('retry-after')
    let seconds = Number(retryAfter)
    if (retryAfter && !Number.isFinite(seconds)) seconds = (Date.parse(retryAfter) - Date.now()) / 1000
    if (!retryAfter) seconds = Number(headers.get('ratelimit-reset')) - Date.now() / 1000
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.ceil(seconds), LONGEST_PAUSE_S) : FALLBACK_PAUSE_S
}

/**
 * Sends once a slot is free; `send` starts its own time limit, so waiting
 * here does not use it up. Requests of an action that writes (`acting`)
 * count towards the minute but never wait for it: an action refused halfway
 * would leave a proposal half made.
 */
export async function throughGate(
    url: string,
    { token, acting = false }: { token: boolean; acting?: boolean },
    send: () => Promise<Response>,
): Promise<Response> {
    const gate = gateFor(url, token)
    const deadline = acting ? Infinity : Date.now() + LONGEST_WAIT_MS
    refuseWhilePaused(gate)
    await takeSlot(gate, deadline)
    try {
        await placeInMinute(gate, deadline, acting)
        const response = await send()
        if (response.status !== 429) return response

        const seconds = pauseSeconds(response.headers)
        gate.pausedUntil = Math.max(gate.pausedUntil, Date.now() + seconds * 1000)
        await response.body?.cancel().catch(() => {})
        console.warn(
            `[gitlab] 429 from ${hostOf(url)} ${token ? 'with' : 'without'} token, ` +
                `limit ${response.headers.get('ratelimit-name') ?? 'not named'}, ` +
                `at ${parts(url).pathname}; no requests for ${seconds} s`,
        )
        throw new GitLabPausedError(gate.pausedUntil)
    } finally {
        releaseSlot(gate)
    }
}
