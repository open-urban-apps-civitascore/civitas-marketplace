'use client'

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'

import { HISTORY_KEY, parseWizardAddress, stepsBack, trailOf, wizardHref, type WizardAddress } from '@/lib/export/wizard-address'

/**
 * The wizard's address (`lib/export/wizard-address.ts`) and the three ways
 * it moves. Written with the browser's own history calls, which Next 16
 * hands on to `useSearchParams` without a server round trip: a step must not
 * read the portal again, nor lose what the form holds.
 *
 * - `forward`: a new history entry, so browser back returns to this step.
 * - `replace`: the same entry with another address - a choice in the
 *   dropdown, a step that was not reachable, a started share continued.
 * - `back`: to an earlier step. When the wizard came from there in this tab,
 *   through history (`history.go`), so the browser's forward button goes one
 *   step forward again; otherwise, after a link straight to a later step, the
 *   entry is replaced and browser back leaves the wizard.
 *
 * Each entry the wizard writes keeps the queries of the steps before it, so
 * `back` knows how far to go; Next keeps such state on its entries.
 */
export function useWizardAddress() {
    const query = useSearchParams()
    const address = useMemo(() => parseWizardAddress(query), [query])

    const replace = useCallback((next: WizardAddress) => {
        window.history.replaceState({ [HISTORY_KEY]: { trail: trailOf(window.history.state) } }, '', wizardHref(next))
    }, [])

    const forward = useCallback((next: WizardAddress) => {
        const trail = [...trailOf(window.history.state), window.location.search]
        window.history.pushState({ [HISTORY_KEY]: { trail } }, '', wizardHref(next))
    }, [])

    const back = useCallback(
        (target: WizardAddress) => {
            const steps = stepsBack(trailOf(window.history.state), target)
            if (steps) window.history.go(-steps)
            else replace(target)
        },
        [replace],
    )

    return { address, forward, replace, back }
}
