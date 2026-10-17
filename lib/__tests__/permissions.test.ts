import { describe, expect, it } from 'vitest'

import { hasTenantPermission } from '@/lib/permissions'

describe('hasTenantPermission', () => {
    it('finds a permission on a tenant-wide assignment', () => {
        const me = {
            assignments: [
                { scopeType: 'TENANT', scopeId: null, permissions: ['DATAPOOL_READ', 'DATAPOOL_CREATE'] },
            ],
        }
        expect(hasTenantPermission(me, 'DATAPOOL_CREATE')).toBe(true)
    })

    it('does not count a permission held on one datapool only, as the portal does not', () => {
        const me = { assignments: [{ scopeType: 'DATAPOOL', scopeId: 'dp1', permissions: ['DATAPOOL_CREATE'] }] }
        expect(hasTenantPermission(me, 'DATAPOOL_CREATE')).toBe(false)
    })

    it('says no to anything it cannot read', () => {
        expect(hasTenantPermission(null, 'DATAPOOL_CREATE')).toBe(false)
        expect(hasTenantPermission({ assignments: 'TENANT' }, 'DATAPOOL_CREATE')).toBe(false)
    })
})
