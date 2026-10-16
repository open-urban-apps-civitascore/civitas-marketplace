/**
 * Runs `work` over `items` with at most `limit` running at once, and returns
 * the results in the order of `items`. For reads against a service that should
 * not get every request at the same moment, but also not one after another.
 */
export async function mapWithLimit<T, R>(
    items: readonly T[],
    limit: number,
    work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length)
    let next = 0
    const worker = async () => {
        while (next < items.length) {
            const index = next++
            results[index] = await work(items[index], index)
        }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
    return results
}
