import { describe, expect, it } from 'vitest'

import { describeDatapoolCreateFailure } from '@/lib/install-payload'

describe('describeDatapoolCreateFailure', () => {
    it('says that nothing was installed and translates the missing right', () => {
        const failure = describeDatapoolCreateFailure(403, 'Forbidden', 'permission_denied')
        expect(failure.status).toBe('error')
        expect(failure.detail).toMatch(/^Datenpool nicht angelegt, nichts installiert: /)
        expect(failure.detail).toContain('Ihrer Rolle fehlt das Recht, Datenpools anzulegen')
    })

    it('passes the backend reason of a rejected name through', () => {
        const failure = describeDatapoolCreateFailure(
            400,
            'Bad Request',
            JSON.stringify({ detail: 'Name must be between 3 and 255 characters' }),
        )
        expect(failure.status).toBe('invalid')
        expect(failure.detail).toContain('Name must be between 3 and 255 characters')
    })

    it('reports a conflict as one', () => {
        expect(describeDatapoolCreateFailure(409, 'Conflict', JSON.stringify({ detail: 'exists' })).status).toBe(
            'conflict',
        )
    })
})
