import { ArrowUpRight, Check, TriangleAlert } from 'lucide-react'

import type { InstallOutcome } from '@/lib/install-actions'

/**
 * A successful install as a short list instead of one line of text: what the
 * platform made (counted per kind), then each follow-up with its own mark, a
 * warning in amber where one did not work, and the way to the installation.
 */
export function InstallOutcomeView({ outcome, installationHref }: { outcome: InstallOutcome; installationHref?: string }) {
    return (
        <div className="mt-3 flex flex-col gap-3 rounded-md border border-success/30 bg-success/5 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-success">
                <Check className="size-4 shrink-0" />
                Installiert: „{outcome.title}“ v{outcome.version}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Angelegt</span>
                {outcome.counts.map(({ count, label }) => (
                    <span
                        key={label}
                        className={`rounded px-1.5 py-0.5 ${count > 0 ? 'bg-muted text-foreground' : 'bg-muted/50 text-muted-foreground'}`}
                    >
                        {count} {label}
                    </span>
                ))}
            </div>
            {outcome.steps.length > 0 && (
                <ul className="flex flex-col gap-1.5 text-xs leading-relaxed">
                    {outcome.steps.map((step, index) => (
                        <li key={index} className="flex items-start gap-2">
                            {step.ok ? (
                                <Check aria-label="erledigt" className="mt-0.5 size-3.5 shrink-0 text-success" />
                            ) : (
                                <TriangleAlert aria-label="Hinweis" className="mt-0.5 size-3.5 shrink-0 text-warn" />
                            )}
                            <span className={step.ok ? 'text-foreground' : 'text-warn'}>
                                {step.text}
                                {step.link && (
                                    <>
                                        {' '}
                                        <a
                                            href={step.link.href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline"
                                        >
                                            {step.link.label}
                                            <ArrowUpRight aria-hidden className="size-3" />
                                        </a>
                                    </>
                                )}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            {installationHref && (
                <a
                    href={installationHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 self-start rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
                >
                    Installation ansehen
                    <ArrowUpRight aria-hidden className="size-3.5" />
                </a>
            )}
        </div>
    )
}
