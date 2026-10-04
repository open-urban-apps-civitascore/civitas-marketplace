'use client'

import { useActionState } from 'react'
import { ExternalLink, GitPullRequest } from 'lucide-react'

import { SubmitButton } from '@/components/catalog/submit-button'
import { proposeAddonInstall, type AddonInstallResult } from '@/lib/addon-install-actions'

const FEEDBACK_STYLES: Record<AddonInstallResult['status'], string> = {
    proposed: 'text-success',
    'already-open': 'text-warn',
    'already-registered': 'text-warn',
    unconfigured: 'text-warn',
    error: 'text-error',
}

/**
 * The wording says "vorschlagen", not "installieren", because that is what
 * actually happens: the marketplace opens a pull request and a human decides.
 * Promising an install here would be the one dishonest label in the flow.
 */
export function AddonInstallButton({ entryId }: { entryId: string }) {
    const [result, formAction, pending] = useActionState(proposeAddonInstall, null)

    return (
        <div className="flex flex-col gap-2">
            <form action={formAction}>
                <input type="hidden" name="entryId" value={entryId} />
                <SubmitButton
                    pending={pending}
                    icon={GitPullRequest}
                    label="Installation vorschlagen"
                    pendingLabel="Erstelle Pull Request …"
                />
            </form>

            {result && (
                <div className={`flex flex-col gap-1 text-xs leading-relaxed ${FEEDBACK_STYLES[result.status]}`}>
                    <p>{result.detail}</p>
                    {result.prUrl && (
                        <a
                            href={result.prUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex w-fit items-center gap-1 font-medium underline underline-offset-2"
                        >
                            Pull Request öffnen
                            <ExternalLink className="size-3" />
                        </a>
                    )}
                </div>
            )}
        </div>
    )
}
