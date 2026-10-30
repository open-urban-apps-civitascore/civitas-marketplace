import { beforeEach } from 'vitest'

import { resetGitLabGateForTests } from '@/lib/gitlab-gate'

// Fakes answer in no time, so a file's tests would share one minute of the gate's count.
beforeEach(() => resetGitLabGateForTests())
