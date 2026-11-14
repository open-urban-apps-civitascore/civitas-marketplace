/** One line of an installation's journal, as far as the dataset is concerned. */
export interface DataSetLine {
    artifactType?: string
    shellId?: string
    name?: string
}

/**
 * The dataset an installation produced, if any. The platform records it as a journal line like
 * every other artifact (`DATA_SET`), not in the installation's header: its id is the line's
 * `shellId`, its name the line's name. The one place that reads it, for the answer of an install
 * and for the installation list alike.
 */
export function installedDataSet(artifacts: readonly DataSetLine[] | undefined): { id?: string; name?: string } {
    return installedDataSets(artifacts)[0] ?? {}
}

/**
 * Every dataset an installation produced, in the order of the journal. A package brings zero,
 * one or several; the views that show one dataset per installation use installedDataSet, which
 * is the first of these.
 */
export function installedDataSets(artifacts: readonly DataSetLine[] | undefined): { id?: string; name?: string }[] {
    return (artifacts ?? [])
        .filter((artifact) => artifact.artifactType === 'DATA_SET')
        .map((line) => ({
            ...(line.shellId ? { id: line.shellId } : {}),
            ...(line.name ? { name: line.name } : {}),
        }))
}
