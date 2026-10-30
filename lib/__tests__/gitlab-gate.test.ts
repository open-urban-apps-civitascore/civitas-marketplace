import { afterEach, describe, expect, it, vi } from 'vitest'

import { GitLabPausedError, pausedUntil, pauseText, throughGate } from '@/lib/gitlab-gate'

const API = 'https://gitlab.example/api/v4/projects/7'

const ok = () => Promise.resolve(new Response('{}', { status: 200 }))

function refused(headers: Record<string, string>): () => Promise<Response> {
    return () => Promise.resolve(new Response('{"message":"Rate limit exceeded"}', { status: 429, headers }))
}

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
})

describe('throughGate', () => {
    it('after a refusal sends nothing until GitLab’s wait is over, and logs the limit by name', async () => {
        vi.useFakeTimers({ now: Date.parse('2026-10-30T12:00:00Z') })
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const failure = await throughGate(API, { token: true }, refused({ 'Retry-After': '120', 'RateLimit-Name': 'throttle_authenticated_api' })).catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(GitLabPausedError)
        expect((failure as Error).message).toBe('GitLab bremst gerade - in etwa 2 Minuten geht es weiter.')
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('limit throttle_authenticated_api'))
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('/api/v4/projects/7'))

        const send = vi.fn(ok)
        await expect(throughGate(`${API}/merge_requests`, { token: true }, send)).rejects.toBeInstanceOf(GitLabPausedError)
        await expect(throughGate(`${API}/merge_requests`, { token: true, acting: true }, send)).rejects.toBeInstanceOf(GitLabPausedError)
        expect(send).not.toHaveBeenCalled()
        expect(pausedUntil(API, true)).toBe(Date.parse('2026-10-30T12:02:00Z'))

        // GitLab counts requests without a token apart.
        expect((await throughGate(API, { token: false }, send)).status).toBe(200)

        vi.setSystemTime(Date.parse('2026-10-30T12:02:01Z'))
        expect(pausedUntil(API, true)).toBeUndefined()
        expect((await throughGate(API, { token: true }, send)).status).toBe(200)
    })

    it('waits as long as RateLimit-Reset says where there is no Retry-After, and a minute where neither is given', async () => {
        vi.useFakeTimers({ now: Date.parse('2026-10-30T12:00:00Z') })
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        const reset = String(Date.parse('2026-10-30T12:10:00Z') / 1000)
        await throughGate(API, { token: false }, refused({ 'RateLimit-Reset': reset })).catch(() => {})
        expect(pausedUntil(API, false)).toBe(Date.parse('2026-10-30T12:10:00Z'))

        await throughGate('https://other.example/x', { token: false }, refused({})).catch(() => {})
        expect(pausedUntil('https://other.example/y', false)).toBe(Date.parse('2026-10-30T12:01:00Z'))
    })

    it('sends at most four at a time', async () => {
        let running = 0
        let most = 0
        const releases: (() => void)[] = []
        const send = () => {
            running++
            most = Math.max(most, running)
            return new Promise<Response>((resolve) =>
                releases.push(() => {
                    running--
                    resolve(new Response('{}'))
                }),
            )
        }
        let finished = 0
        for (let n = 0; n < 10; n++) void throughGate(API, { token: true }, send).then(() => finished++)
        while (finished < 10) {
            await new Promise((resolve) => setTimeout(resolve, 0))
            releases.shift()?.()
        }
        expect(most).toBe(4)
    })

    it('refuses a read that would wait long for room in the minute, without asking GitLab, and lets an action through', async () => {
        vi.stubEnv('GITLAB_REQUESTS_PER_MINUTE', '3')
        const send = vi.fn(ok)
        for (let n = 0; n < 3; n++) await throughGate(API, { token: true }, send)

        const failure = await throughGate(API, { token: true }, send).catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(GitLabPausedError)
        expect((failure as Error).message).toBe('GitLab bremst gerade - in etwa einer Minute geht es weiter.')
        expect(send).toHaveBeenCalledTimes(3)
        // Not a pause GitLab asked for.
        expect(pausedUntil(API, true)).toBeUndefined()

        expect((await throughGate(API, { token: true, acting: true }, send)).status).toBe(200)
        expect(send).toHaveBeenCalledTimes(4)
    })

    it('refuses a read that waited too long for a slot, and sends none that waited while GitLab refused another', async () => {
        vi.useFakeTimers({ now: Date.parse('2026-10-30T12:00:00Z') })
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const answers: ((response: Response) => void)[] = []
        const slow = () => new Promise<Response>((resolve) => answers.push(resolve))
        const busy = Array.from({ length: 4 }, () => throughGate(API, { token: true }, slow))

        const send = vi.fn(ok)
        const late = throughGate(API, { token: true }, send).catch((error: unknown) => error)
        const acting = throughGate(API, { token: true, acting: true }, send).catch((error: unknown) => error)
        await vi.advanceTimersByTimeAsync(15_000)
        expect(await late).toBeInstanceOf(GitLabPausedError)

        // The action waited on; GitLab then refuses one of the four.
        answers[0](new Response('', { status: 429, headers: { 'Retry-After': '60' } }))
        expect(await acting).toBeInstanceOf(GitLabPausedError)
        expect(send).not.toHaveBeenCalled()

        answers.slice(1).forEach((answer) => answer(new Response('{}')))
        await Promise.allSettled(busy)
    })

    it('sends no read that waited for room in the minute while GitLab refused another', async () => {
        vi.useFakeTimers({ now: Date.parse('2026-10-30T12:00:00Z') })
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.stubEnv('GITLAB_REQUESTS_PER_MINUTE', '2')
        await throughGate(API, { token: true }, ok)
        vi.setSystemTime(Date.parse('2026-10-30T12:00:50Z'))
        let refuse: (response: Response) => void = () => {}
        const refused = throughGate(API, { token: true }, () => new Promise<Response>((resolve) => (refuse = resolve))).catch(() => {})

        // The minute is full until 12:01:00, ten seconds on: this read waits.
        const send = vi.fn(ok)
        const waiting = throughGate(API, { token: true }, send).catch((error: unknown) => error)
        await vi.advanceTimersByTimeAsync(1_000)
        refuse(new Response('', { status: 429, headers: { 'Retry-After': '120' } }))
        await refused
        await vi.advanceTimersByTimeAsync(10_000)

        expect(await waiting).toBeInstanceOf(GitLabPausedError)
        expect(send).not.toHaveBeenCalled()
    })
})

describe('pauseText', () => {
    it('rounds up to whole minutes, at least one', () => {
        expect(pauseText(10_000, 0)).toBe('GitLab bremst gerade - in etwa einer Minute geht es weiter.')
        expect(pauseText(61_000, 0)).toBe('GitLab bremst gerade - in etwa 2 Minuten geht es weiter.')
        expect(pauseText(0, 5_000)).toBe('GitLab bremst gerade - in etwa einer Minute geht es weiter.')
    })
})
