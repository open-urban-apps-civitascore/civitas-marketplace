import { describe, expect, it } from 'vitest'

import { describeReleaseFailure } from '@/lib/install-payload'

describe('describeReleaseFailure', () => {
    it('names the backend reason and leaves a draft when staging is refused', () => {
        const segment = describeReleaseFailure(
            'stage',
            400,
            'Bad Request',
            JSON.stringify({ detail: 'DataSet must contain at least one Pipeline before staging' }),
        )
        expect(segment).toContain('(400): DataSet must contain at least one Pipeline before staging.')
        expect(segment).toContain('bleibt ein Entwurf')
    })

    it('leaves a staged dataset when the release is refused, without a doubled full stop', () => {
        const segment = describeReleaseFailure(
            'release',
            422,
            'Unprocessable Content',
            JSON.stringify({ detail: 'A pipeline DataSource is out of the dataset datapool scope.' }),
        )
        expect(segment).toContain('bereit zur Freigabe')
        expect(segment).not.toContain('..')
    })

    it('translates the gateway refusal into the missing right', () => {
        const segment = describeReleaseFailure('release', 403, 'Forbidden', 'permission_denied')
        expect(segment).toContain('Ihrer Rolle fehlt das Recht, Datensätze freizugeben')
    })
})
