/**
 * The signed-in person's rights, read the way the portal reads them
 * (`hasPermissionInScope` in its use-permissions hook) from the assignments
 * `GET /v1/users/me` returns.
 *
 * Only for what a page OFFERS. Whether an action is allowed is still decided
 * by the platform on the call itself; this keeps an option that would be
 * refused from being offered, or preselected.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether one of the person's assignments grants the permission across the whole tenant. */
export function hasTenantPermission(me: unknown, permission: string): boolean {
    if (!isRecord(me) || !Array.isArray(me.assignments)) return false
    return me.assignments.some(
        (assignment) =>
            isRecord(assignment) &&
            assignment.scopeType === 'TENANT' &&
            Array.isArray(assignment.permissions) &&
            assignment.permissions.includes(permission),
    )
}
