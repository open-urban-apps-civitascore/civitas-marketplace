import { Code } from '@/components/catalog/code'
import type { AddonEntry } from '@/lib/addon-catalog'
import { addonDir, componentLine } from '@/lib/deployment-repo/compose'

/**
 * Exactly what the proposal would change, shown before anyone clicks. This is
 * what makes the feature usable without a forge credential at all: an operator
 * can read the change here and apply it by hand.
 */
export function AddonChangePreview({
    entry,
    registrationPath,
}: {
    entry: AddonEntry
    registrationPath: string
}) {
    const { manifest } = entry
    const paths = Object.keys(entry.files)

    return (
        <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer underline-offset-2 hover:underline">
                Was dieser Vorschlag ändert
            </summary>
            <div className="mt-2 flex flex-col gap-2">
                <p>
                    Eine Zeile in <Code>{registrationPath}</Code>:
                </p>
                <pre className="overflow-x-auto rounded bg-muted p-2">
                    <code>{componentLine(manifest, '')}</code>
                </pre>
                <p>
                    Dazu {paths.length} neue Dateien unter <Code>{addonDir(manifest)}/</Code>:
                </p>
                <ul className="flex flex-col gap-0.5">
                    {paths.map((path) => (
                        <li key={path} className="break-all">
                            <code>{path}</code>
                        </li>
                    ))}
                </ul>
                <p>
                    Erreichbar wird das Add-on anschließend unter{' '}
                    <Code>{manifest.subdomain}.&lt;Domain&gt;</Code>.
                </p>
            </div>
        </details>
    )
}
