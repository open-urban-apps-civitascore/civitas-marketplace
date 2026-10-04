/**
 * Which deployment repository this marketplace proposes add-on installs to.
 *
 * This is per-instance operator configuration, exactly like the Keycloak client
 * secret: every commune runs its own CIVITAS/CORE with its own deployment
 * repository. The credential belongs to the SERVICE, not to the person
 * clicking install — nobody using the marketplace needs a forge account.
 *
 * Note what that shifts: for use-case installs the user's own token made the
 * backend the authority on who may do what. Here a service credential replaces
 * it, and nothing has taken over that job — any signed-in user can propose.
 * Proposing is low-risk (a human still merges), but gating this on a platform
 * role is outstanding work, not an implemented control.
 */
export interface DeploymentRepoConfig {
    /** `owner/name` on the forge. */
    repo: string
    /** Branch the pull request targets — the branch that describes the live instance. */
    baseBranch: string
    /** Environment folder under `deployment/environments/` whose component list is edited. */
    environment: string
    /** Absent when no credential is configured: installs then fall back to the manual change. */
    token?: string
}

export function deploymentRepoConfig(): DeploymentRepoConfig {
    return {
        repo: process.env.DEPLOYMENT_REPO ?? '',
        baseBranch: process.env.DEPLOYMENT_REPO_BRANCH ?? 'main',
        environment: process.env.DEPLOYMENT_ENVIRONMENT ?? 'local',
        token: process.env.DEPLOYMENT_REPO_TOKEN || undefined,
    }
}

/**
 * Why an install cannot open a pull request — the two reasons need different
 * answers from whoever reads them ("configure a repository" vs "the repository
 * is set, it still needs a credential"), so they must not collapse into one
 * message.
 */
export type ForgeReadiness = 'ready' | 'missing-repo' | 'missing-token'

export function forgeReadiness(config: DeploymentRepoConfig): ForgeReadiness {
    if (!config.repo) return 'missing-repo'
    if (!config.token) return 'missing-token'
    return 'ready'
}

export function environmentFilePath(config: DeploymentRepoConfig): string {
    return `deployment/environments/${config.environment}/global.yaml.gotmpl`
}
