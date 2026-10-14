import { PlayCircle, Radio, Trash2 } from 'lucide-react'

import { IconTile } from '@/components/ui/icon-tile'
import { Panel } from '@/components/ui/layout'

/**
 * Bundled demo data, stated as a fact and not as a call to action - the
 * clickdummy's `DemoDataHighlight`. An earlier version there was a green
 * banner with a verb phrase, and people tried to click it; the actual choice
 * is in the install dialog's first step.
 *
 * Only for a package that ships demo data: a store that promises sample data
 * and then shows an empty dataset burns the trust the catalogue is built on.
 */
export function DemoDataPanel({ streams, simulatorAvailable }: { streams: string[]; simulatorAvailable: boolean }) {
    return (
        <Panel title="Demo-Daten enthalten" icon={<IconTile icon={PlayCircle} tone="usecase" />}>
            <p className="text-sm leading-relaxed text-muted-foreground">
                Dieser Anwendungsfall bringt Beispieldaten mit. Beim Nachnutzen können Sie wählen, ob Sie damit
                starten - das Ergebnis ist dann sofort mit Daten gefüllt, und ob Sie eigene Datenquellen anbinden,
                entscheiden Sie später.{' '}
                <span>
                    Enthalten: <span className="font-medium text-foreground">{streamsText(streams)}</span>.
                </span>
            </p>
            {!simulatorAvailable && (
                <p className="text-sm text-muted-foreground">
                    Auf dieser Instanz ist der Demo-Daten-Simulator nicht eingerichtet. Ohne ihn lässt sich der
                    Anwendungsfall nur mit eigenen Daten nutzen.
                </p>
            )}
            <ul className="grid gap-2 sm:grid-cols-2">
                <Point icon={Radio} label="Keine eigenen Sensoren nötig" />
                <Point icon={Trash2} label="Lässt sich wieder entfernen" />
            </ul>
        </Panel>
    )
}

/** "ein Datenstrom (Baumkataster)", or the count and the first three: a package can ship twenty. */
function streamsText(streams: string[]): string {
    if (streams.length === 1) return `ein Datenstrom („${streams[0]}“)`
    const named = streams.slice(0, 3).map((name) => `„${name}“`).join(', ')
    return streams.length > 3 ? `${streams.length} Datenströme, darunter ${named}` : `${streams.length} Datenströme (${named})`
}

function Point({ icon: Icon, label }: { icon: typeof PlayCircle; label: string }) {
    return (
        <li className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground">
            <Icon aria-hidden className="size-4 shrink-0" />
            {label}
        </li>
    )
}
