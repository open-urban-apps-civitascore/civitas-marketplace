import { Section } from '@/components/ui/layout'
import type { CatalogSummary } from '@/lib/catalog/types'
import { LOGIC_MODEL_STEPS } from '@/lib/catalog/vocabulary'

/**
 * The Wirkungslogik as one chain: Input, Output, Outcome, Impact - the
 * clickdummy's `LogicModel`. Its own section, because it is the business
 * argument, not a technical fact.
 *
 * A 2x2 grid inside the reading column: the values are whole sentences, which
 * get a readable line length this way, and the numbers carry the order. Every
 * step keeps its gloss, because nobody outside programme evaluation tells
 * Outcome from Impact. All four steps stay, an empty one saying so: a chain
 * with a gap reads as a chain with a gap.
 */
export function LogicModel({ entry }: { entry: CatalogSummary }) {
    const logicModel = entry.implementation?.logicModel
    const steps = LOGIC_MODEL_STEPS.map((step) => ({ ...step, value: logicModel?.[step.key] }))
    if (!steps.some((step) => step.value)) return null

    return (
        <Section
            id="wirkung"
            title="Was dieser Anwendungsfall bewirkt"
            lead="Die Wirkungslogik in vier Schritten - von dem, was hineingegeben wurde, bis zu dem, was sich in der Kommune ändert."
        >
            <ol className="grid gap-4 sm:grid-cols-2">
                {steps.map((step, position) => (
                    <li key={step.key} className="flex">
                        <div className="flex w-full flex-col rounded-md border bg-background p-4">
                            <p className="flex items-baseline gap-2">
                                <span aria-hidden className="text-xs font-semibold tabular-nums text-muted-foreground">
                                    {position + 1}
                                </span>
                                <span className="text-sm font-semibold text-foreground">{step.label}</span>
                                <span className="text-xs text-muted-foreground">{step.gloss}</span>
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.hint}</p>
                            <p className="mt-3 border-t pt-3 text-sm leading-relaxed text-foreground">
                                {step.value ?? <span className="text-muted-foreground">Nicht angegeben.</span>}
                            </p>
                        </div>
                    </li>
                ))}
            </ol>
        </Section>
    )
}
