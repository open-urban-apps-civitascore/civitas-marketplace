import type { AddonEntry, AddonManifest } from '@/lib/addon-catalog'
import { environmentFilePath, type DeploymentRepoConfig } from './config'

/**
 * Composing the change is deliberately separate from delivering it. The same
 * result is used to open a pull request AND to show the operator exactly what
 * would change — so the feature stays demonstrable, and usable, on an instance
 * that has no forge credential at all.
 *
 * Nothing here talks to the network, which also makes the interesting part
 * (editing someone else's component list) verifiable in isolation.
 */
export interface ComposedInstall {
    /** New files, keyed by their path in the deployment repository. */
    files: Record<string, string>
    /** The environment file that gains exactly one line. */
    registrationPath: string
    /** Deterministic, so clicking twice targets the same branch instead of piling up. */
    branch: string
}

/** The add-on's folder in the deployment repository — this module owns that layout. */
export function addonDir(manifest: AddonManifest): string {
    return `deployment/addons/${manifest.componentName}`
}

/**
 * The line that registers the component. One builder for both callers: the
 * preview renders it at the canonical indentation, the editor re-renders it at
 * whatever indentation the target file actually uses.
 */
export function componentLine(manifest: AddonManifest, indent = '  '): string {
    return `${indent}- ${manifest.componentName}  # AppStore add-on (${addonDir(manifest)})`
}

export function composeAddonInstall(
    entry: AddonEntry,
    config: DeploymentRepoConfig,
): ComposedInstall {
    const dir = addonDir(entry.manifest)
    const files: Record<string, string> = {}
    for (const [relativePath, content] of Object.entries(entry.files)) {
        files[`${dir}/${relativePath}`] = content
    }

    return {
        files,
        registrationPath: environmentFilePath(config),
        branch: `appstore/install-${entry.manifest.componentName}`,
    }
}

export type RegistrationOutcome =
    | { status: 'inserted'; content: string; line: string }
    | { status: 'already-registered' }
    | { status: 'no-component-list' }

/**
 * Adds the component to the environment's `components` list.
 *
 * The list is an ordered YAML array, and helmfile REPLACES arrays rather than
 * merging them, so the entry has to go into the environment's own list — there
 * is no "append" from elsewhere. Indentation is copied from the existing items
 * instead of assumed, and the entry is appended last: order expresses
 * dependencies, and an add-on depends on core components while nothing depends
 * on it.
 *
 * Commented-out entries (`# - networkpolicies`) are intentionally not treated
 * as registered — they are disabled components, not installed ones.
 */
export function registerComponent(
    fileContent: string,
    manifest: AddonManifest,
): RegistrationOutcome {
    const lines = fileContent.split('\n')
    const listStart = lines.findIndex((line) => /^components:[ \t]*$/.test(line))
    if (listStart === -1) return { status: 'no-component-list' }

    let lastItem = -1
    let indent = '  '

    for (let i = listStart + 1; i < lines.length; i++) {
        const line = lines[i]
        // Blank lines and comments may sit between entries without ending the list.
        if (line.trim() === '' || /^\s*#/.test(line)) continue

        const item = /^(\s+)-\s+(\S+)/.exec(line)
        if (!item) break // a line at column 0 — the next top-level key, list is over
        if (item[2] === manifest.componentName) return { status: 'already-registered' }

        indent = item[1]
        lastItem = i
    }

    const line = componentLine(manifest, indent)
    lines.splice(lastItem === -1 ? listStart + 1 : lastItem + 1, 0, line)

    return { status: 'inserted', content: lines.join('\n'), line }
}

export function pullRequestTitle(entry: AddonEntry): string {
    return `Install add-on: ${entry.manifest.displayName}`
}

/**
 * The PR body is the review surface: an operator who never opened the
 * marketplace should be able to judge this change from the pull request alone.
 * It shows the line as actually inserted, not the canonical form.
 */
export function pullRequestBody(
    entry: AddonEntry,
    change: ComposedInstall,
    insertedLine: string,
    requestedBy: string,
): string {
    const { manifest } = entry

    return [
        `Proposed by the CIVITAS AppStore on behalf of **${requestedBy}**.`,
        '',
        `## ${manifest.displayName}`,
        '',
        manifest.description,
        '',
        '## What this changes',
        '',
        `- adds \`${addonDir(manifest)}/\` (${Object.keys(change.files).length} files) — the add-on's deployment package`,
        `- registers it in \`${change.registrationPath}\`:`,
        '',
        '```yaml',
        insertedLine,
        '```',
        '',
        '## After merging',
        '',
        'Nothing happens until someone applies the deployment. On the next apply,',
        `helmfile picks the component up from \`${addonDir(manifest)}/\``,
        `and it becomes reachable at \`https://${manifest.subdomain}.<instance domain>\` —`,
        'the gateway route also puts that host on the shared ingress and into the',
        'TLS certificate.',
        '',
        '## Reverting',
        '',
        `Delete the folder and remove the \`${manifest.componentName}\` line.`,
        '',
        '---',
        '',
        `Version ${manifest.version} · ${manifest.license} · maintained by ${manifest.maintainer}`,
    ].join('\n')
}
