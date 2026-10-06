import { describe, expect, it } from 'vitest'

import { uninstallBlocker } from '@/lib/uninstall-blocker'

describe('uninstallBlocker', () => {
    it('blocks a released dataset and warns that deleting it loses the data', () => {
        const blocker = uninstallBlocker({ datapool: null, status: 'AVAILABLE' })
        expect(blocker?.remedy).toContain('Freigabe zurücknehmen')
        expect(blocker?.warning).toContain('verloren')
    })

    it.each(['DRAFT', 'READY'])('leaves a %s dataset to the server', (status) => {
        expect(uninstallBlocker({ datapool: null, status })).toBeNull()
    })

    it('says nothing when the status is unknown or the dataset could not be read', () => {
        expect(uninstallBlocker({ datapool: null })).toBeNull()
        expect(uninstallBlocker(null)).toBeNull()
    })
})
