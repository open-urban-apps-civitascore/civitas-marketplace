import { GitLabReadCache } from '@/lib/export/gitlab'

/**
 * The memory of the "Geteilte Pakete" list: what it read at a commit, or from
 * a merged merge request, and therefore never has to ask again (see
 * `GitLabReadCache`). In a module of its own, because the actions file may
 * export nothing but server actions.
 */
export const SHARE_READS = new GitLabReadCache()
