import { beforeEach } from 'vitest'

import { resetBundleCacheForTests } from '@/lib/catalog/bundle'
import { resetGitLabGateForTests } from '@/lib/gitlab-gate'

// Fakes answer in no time, so a file's tests would share one minute of the gate's count;
// and a package kept, or its failure, would carry over to the next test.
beforeEach(() => {
    resetGitLabGateForTests()
    resetBundleCacheForTests()
})
