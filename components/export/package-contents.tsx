'use client'

import { Fragment } from 'react'
import { CircleCheck, CirclePlay, Database, Layers, MapIcon, Radio } from 'lucide-react'

import { Button, ExternalAnchor } from '@/components/ui/button'
import { Flow, FlowGroup, FlowHeading, FlowItem, FlowNote } from '@/components/ui/flow'
import { InlineNotice } from '@/components/ui/notice'
import { StatusPill } from '@/components/ui/status-pill'
import type { DemoInventory, InventoryArtifact } from '@/lib/export-actions'
import type { DemoSource } from '@/lib/export/simulations'
import type { ExportSource } from '@/lib/export/sources'
import { newSimulationUiHref } from '@/lib/simulator/ui-links'
import { ARTIFACT_KINDS, byKind, partsCount } from '@/lib/ui/artifact-kinds'
import { datasetStatusLabel } from '@/lib/ui/dataset-status'

const UNNAMED_NOTE = 'Im Portal ohne eigenen Namen - so steht der Name auch im Paket. Vor dem Teilen im Portal umbenennen.'

/**
 * What goes into the package, shown the way the installed view shows what an
 * installation made (Ewa, 2026-10-13): one card per system, joined in the
 * order the data flows. Demo data comes first, because that is where the data
 * starts.
 *
 * The tiles stay neutral until the flow cards' colours are aligned with the
 * design system; a green "Plattform" tile next to a green "Freigegeben" would
 * make one green read as the other.
 */
export function PackageContents({
    source,
    artifacts,
    demo,
    demoExcluded,
    onToggleDemo,
    onReloadDemo,
}: {
    source: ExportSource
    artifacts: InventoryArtifact[]
    demo?: DemoInventory
    demoExcluded: ReadonlySet<string>
    onToggleDemo: (streamId: string) => void
    onReloadDemo: () => void
}) {
    const platform = artifacts.filter((item) => item.group !== 'map')
    const map = artifacts.filter((item) => item.group === 'map')
    // The API standards say what kind of map service comes along ("OWS"); the rows name them again.
    const standards = [...new Set(map.flatMap((item) => (item.standard ? [item.standard] : [])))]

    return (
        <Flow>
            {demo && <DemoGroup key="demo" demo={demo} excluded={demoExcluded} onToggle={onToggleDemo} onReload={onReloadDemo} />}
            <FlowGroup
                key="platform"
                icon={Layers}
                tone="neutral"
                title="Plattform"
                subtitle="CIVITAS/CORE"
                meta={platform.length ? partsCount(platform.length) : undefined}
            >
                <FlowItem
                    icon={<Database className="size-4" />}
                    kind="Datensatz"
                    name={source.name}
                    badge={
                        source.status ? (
                            source.status === 'AVAILABLE' ? (
                                <StatusPill tone="success" icon={CircleCheck}>
                                    {datasetStatusLabel(source.status)}
                                </StatusPill>
                            ) : (
                                <StatusPill tone="muted">{datasetStatusLabel(source.status)}</StatusPill>
                            )
                        ) : undefined
                    }
                />
                {/* Grouped by kind, so "which ones, and how many" reads at a glance. */}
                {byKind(platform).map(({ type, items }) => (
                    <Fragment key={type}>
                        <FlowHeading>{items.length === 1 ? ARTIFACT_KINDS[type].one : `${ARTIFACT_KINDS[type].many} (${items.length})`}</FlowHeading>
                        {items.map((item, index) => (
                            <ArtifactRow key={`${type}:${item.name}:${index}`} item={item} kindShown={false} />
                        ))}
                    </Fragment>
                ))}
                {artifacts.length === 0 && <FlowNote>Keine verbundenen Bausteine gefunden.</FlowNote>}
            </FlowGroup>
            {map.length > 0 && (
                <FlowGroup key="map" icon={MapIcon} tone="neutral" title="Karte" subtitle={standards.length ? `API: ${standards.join(', ')}` : undefined}>
                    {/* Not grouped: a layer sits under its API, which a grouping by kind would tear apart. */}
                    {map.map((item, index) => (
                        <ArtifactRow key={`map:${item.type}:${item.name}:${index}`} item={item} kindShown />
                    ))}
                </FlowGroup>
            )}
        </Flow>
    )
}

/**
 * One artifact, named as the package will name it. A name the platform did
 * not have is shown as it ships, with a note, rather than hidden: the other
 * municipality will see exactly this name. `kindShown` is off under a heading
 * that already names the kind.
 */
function ArtifactRow({ item, kindShown }: { item: InventoryArtifact; kindShown: boolean }) {
    const { one, icon: Icon } = ARTIFACT_KINDS[item.type]
    const note = [item.detail, item.unnamed ? UNNAMED_NOTE : undefined].filter(Boolean).join(' · ')
    return (
        <FlowItem
            icon={<Icon className="size-4" />}
            // An API's kind carries its standard, e.g. "API (OWS)".
            kind={kindShown ? (item.type === 'api' ? item.kind : one) : undefined}
            name={item.name}
            note={note || undefined}
            depth={item.depth}
        />
    )
}

/** Optional demo data: the simulator's streams that feed the dataset's sources, ticked to take them along. */
function DemoGroup({
    demo,
    excluded,
    onToggle,
    onReload,
}: {
    demo: DemoInventory
    excluded: ReadonlySet<string>
    onToggle: (streamId: string) => void
    onReload: () => void
}) {
    const usable = demo.sources.filter((source) => !source.problem)
    const total = usable.reduce((count, source) => count + source.streams.length, 0)
    const chosen = usable.reduce((count, source) => count + source.streams.filter((stream) => !excluded.has(stream.id)).length, 0)

    return (
        <FlowGroup
            icon={CirclePlay}
            tone="neutral"
            title="Demo-Daten"
            subtitle="Simulator - freiwillig"
            meta={total > 0 ? `${chosen} von ${total} ausgewählt` : undefined}
            footer={
                <div className="flex flex-col items-start gap-1 pb-1">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        Angehakte Datenströme kommen ins Paket. Eine Installation startet sie für ihre eigenen Datenquellen.
                    </p>
                    <Button variant="ghost" className="text-xs" onClick={onReload}>
                        Erneut prüfen
                    </Button>
                </div>
            }
        >
            {demo.problem ? (
                <FlowNote>
                    <InlineNotice tone="neutral">{demo.problem}</InlineNotice>
                </FlowNote>
            ) : demo.sources.length === 0 ? (
                <FlowNote>Dieser Datensatz hat keine MQTT- oder SQL-Quelle, für die der Simulator Daten erzeugen könnte.</FlowNote>
            ) : (
                demo.sources.map((source) => (
                    <DemoSourceRows key={source.id} source={source} simulatorUi={demo.simulatorUi} excluded={excluded} onToggle={onToggle} />
                ))
            )}
        </FlowGroup>
    )
}

function DemoSourceRows({
    source,
    simulatorUi,
    excluded,
    onToggle,
}: {
    source: DemoSource
    simulatorUi?: string
    excluded: ReadonlySet<string>
    onToggle: (streamId: string) => void
}) {
    const transport = source.transport === 'mqtt' ? 'MQTT' : 'SQL'
    // Without a Topic the package cannot say where its streams publish: shown, but not offered.
    const blocked = source.problem === 'no-topic'

    return (
        <>
            {blocked && (
                <FlowNote>
                    <InlineNotice tone="warn">
                        Keine Demo-Daten für „{source.name}“ möglich - diese Datenquelle hat im Portal noch kein Topic.
                        {source.portalHref && (
                            <>
                                {' '}
                                <ExternalAnchor href={source.portalHref}>Topic im Portal eintragen</ExternalAnchor>
                            </>
                        )}
                    </InlineNotice>
                </FlowNote>
            )}
            {source.streams.map((stream) => (
                <FlowItem
                    key={stream.id}
                    control={
                        <input
                            type="checkbox"
                            className="size-4 shrink-0 accent-primary"
                            checked={!blocked && !excluded.has(stream.id)}
                            disabled={blocked}
                            onChange={() => onToggle(stream.id)}
                        />
                    }
                    icon={<Radio className="size-4" />}
                    name={stream.label}
                    note={`für Datenquelle „${source.name}“ · ${transport}${stream.matchedBy === 'address' ? ' · über Topic oder Tabelle zugeordnet' : ''}`}
                />
            ))}
            {!blocked && source.streams.length === 0 && (
                <FlowNote>
                    Für „{source.name}“ gibt es noch keine Demo-Daten.
                    {simulatorUi && source.structureUrn && (
                        <>
                            {' '}
                            <ExternalAnchor href={newSimulationUiHref(simulatorUi, source.structureUrn, source.id)}>Im Simulator anlegen</ExternalAnchor>
                        </>
                    )}
                </FlowNote>
            )}
        </>
    )
}
