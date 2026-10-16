import { describe, expect, it } from 'vitest'

import { mapWithLimit } from '@/lib/concurrency'

describe('mapWithLimit', () => {
    it('keeps the order of the items, whichever finishes first', async () => {
        const delays = [30, 5, 20, 1]
        const results = await mapWithLimit(delays, 2, (delay, index) => new Promise<number>((resolve) => setTimeout(() => resolve(index), delay)))
        expect(results).toEqual([0, 1, 2, 3])
    })

    it('never runs more than the limit at once', async () => {
        let running = 0
        let most = 0
        await mapWithLimit(Array.from({ length: 9 }, (_, n) => n), 3, async () => {
            running++
            most = Math.max(most, running)
            await new Promise((resolve) => setTimeout(resolve, 2))
            running--
        })
        expect(most).toBe(3)
    })

    it('handles an empty list', async () => {
        expect(await mapWithLimit([], 5, async () => 1)).toEqual([])
    })
})
