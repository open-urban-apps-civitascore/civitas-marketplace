/**
 * Links into the simulator's own web interface (civitas-data-source-simulator,
 * `ui/`), where one simulation can be watched live.
 *
 * The base is SIMULATOR_UI_URL, the address a BROWSER reaches. It is not
 * SIMULATOR_API_URL: that is the generator's control API inside the cluster,
 * no page a person could open. Unset, no link renders.
 *
 * Reading the variable and building a link are split on purpose: the first
 * runs on the server only, the second is pure, so the client-side simulator
 * panel can build links for the streams it polls from a base it was handed.
 */

export function simulatorUiUrl(): string | undefined {
    const raw = process.env.SIMULATOR_UI_URL?.trim()
    return raw ? raw.replace(/\/+$/, '') : undefined
}

/** The simulator UI's page of one simulation: overview, on/off and the live events. */
export function simulationUiHref(base: string, simulationId: string): string {
    return `${base}/simulations/${encodeURIComponent(simulationId)}`
}
