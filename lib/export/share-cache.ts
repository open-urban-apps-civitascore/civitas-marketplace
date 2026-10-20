import { GitLabReadCache } from '@/lib/export/gitlab'

/**
 * How many answers the listing keeps. It reads up to 300 proposals per
 * project since rc.6 (`AUTHOR_PAGES`), and a merged version alone keeps about
 * four (its commits, the trees at them, its manifest, its README). The
 * cache lets the oldest answers go first, so a limit below what one visit
 * reads would push out exactly what the next visit needs, and every visit
 * would ask GitLab for all of it again. The answers are small texts, a few
 * megabytes at this size.
 */
const SHARE_READS_LIMIT = 4000

/**
 * The memory of the share listing (`share-listing.ts`): what it read at a
 * commit, from a merged or a closed merge request, and the projects and the
 * account it works with - none of which it has to ask again (see
 * `GitLabReadCache`). In a module of its own, so the actions file, which may
 * export nothing but server actions, and the listing share it.
 */
export const SHARE_READS = new GitLabReadCache(SHARE_READS_LIMIT)
