import type { AddonPackage } from '@/lib/package-file'
import { environmentFilePath, type DeploymentRepoConfig } from './config'

/**
 * Everything needed to propose one add-on install: the listing's identity plus
 * the package fetched from the maintainer's repository.
 */
export interface InstallCandidate {
    componentName: string
    subdomain: string
    displayName: string
    description: string
    publisher: string
    license?: string
    /** What is being installed — a tag or a short commit. */
    version?: string
    /** The deployment package, keyed by path relative to the package root. */
    files: AddonPackage
}

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
    files: AddonPackage
    /** The environment file that gains exactly one line. */
    registrationPath: string
    /** Deterministic, so clicking twice targets the same branch instead of piling up. */
    branch: string
}

/**
 * Everything the layout functions need — the detail page composes these strings
 * from a catalogue listing, which carries the component name and nothing else.
 */
export interface ComponentIdentity {
    componentName: string
}

/** The add-on's folder in the deployment repository — this module owns that layout. */
export function addonDir(component: ComponentIdentity): string {
    return `deployment/addons/${component.componentName}`
}

/**
 * The line that registers the component. One builder for both callers: the
 * preview renders it at the canonical indentation, the editor re-renders it at
 * whatever indentation the target file actually uses.
 */
export function componentLine(component: ComponentIdentity, indent = '  '): string {
    return `${indent}- ${component.componentName}  # AppStore add-on (${addonDir(component)})`
}

export function composeAddonInstall(
    candidate: InstallCandidate,
    config: DeploymentRepoConfig,
): ComposedInstall {
    const dir = addonDir(candidate)
    const files: AddonPackage = {}
    for (const [relativePath, file] of Object.entries(candidate.files)) {
        files[`${dir}/${relativePath}`] = file
    }

    return {
        files,
        registrationPath: environmentFilePath(config),
        branch: `appstore/install-${candidate.componentName}`,
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
    component: ComponentIdentity,
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
        if (item[2] === component.componentName) return { status: 'already-registered' }

        indent = item[1]
        lastItem = i
    }

    const line = componentLine(component, indent)
    lines.splice(lastItem === -1 ? listStart + 1 : lastItem + 1, 0, line)

    return { status: 'inserted', content: lines.join('\n'), line }
}

export function pullRequestTitle(candidate: InstallCandidate): string {
    return `Install add-on: ${candidate.displayName}`
}

/**
 * The PR body is the review surface: an operator who never opened the
 * marketplace should be able to judge this change from the pull request alone.
 * It shows the line as actually inserted, not the canonical form.
 */
export function pullRequestBody(
    candidate: InstallCandidate,
    change: ComposedInstall,
    insertedLine: string,
    requestedBy: string,
    /** Where the package was fetched from, so a reviewer can verify the bytes. */
    provenance?: string,
): string {
    const manifest = candidate

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
        ...(provenance ? [`  fetched verbatim from ${provenance}`] : []),
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
        [
            manifest.version ? `Version ${manifest.version}` : null,
            manifest.license,
            `maintained by ${manifest.publisher}`,
        ]
            .filter(Boolean)
            .join(' · '),
    ].join('\n')
}
