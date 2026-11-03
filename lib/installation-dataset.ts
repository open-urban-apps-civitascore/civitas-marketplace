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
    const line = artifacts?.find((artifact) => artifact.artifactType === 'DATA_SET')
    return {
        ...(line?.shellId ? { id: line.shellId } : {}),
        ...(line?.name ? { name: line.name } : {}),
    }
}
