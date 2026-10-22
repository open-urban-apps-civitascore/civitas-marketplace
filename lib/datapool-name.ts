/**
 * Naming a datapool the install creates. Pure, so the install dialog (a client
 * component) and the server action can share the bounds.
 */

/** The platform's bounds for a datapool name (DataPoolInputDTO). */
export const DATAPOOL_NAME_MIN = 3
export const DATAPOOL_NAME_MAX = 255

/** Room for a counter such as " (12)" behind a name at the limit. */
const COUNTER_ROOM = 6

/**
 * The name the install dialog proposes for a new datapool: the use case and
 * the version it was installed at, so the pool says in the portal where it
 * came from. A name a visible pool already carries gets a counter: two pools
 * of one name in the portal's list help nobody.
 */
export function suggestDatapoolName(
    displayName: string,
    version: string,
    takenNames: readonly string[],
): string {
    const bareVersion = version.trim().replace(/^v/i, '')
    const joined = [displayName.trim(), bareVersion && `v${bareVersion}`].filter(Boolean).join(' ')
    const base = (joined.length >= DATAPOOL_NAME_MIN ? joined : 'Datenpool').slice(
        0,
        DATAPOOL_NAME_MAX - COUNTER_ROOM,
    )

    const taken = new Set(takenNames.map((name) => name.trim().toLocaleLowerCase('de')))
    let candidate = base
    for (let counter = 2; taken.has(candidate.toLocaleLowerCase('de')); counter += 1) {
        candidate = `${base} (${counter})`
    }
    return candidate
}
