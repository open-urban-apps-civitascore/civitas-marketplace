/** The platform's dataset status, in the words the portal's own buttons use. */
export const DATASET_STATUS_LABELS: Record<string, string> = {
    DRAFT: 'Entwurf',
    READY: 'Bereit zur Freigabe',
    AVAILABLE: 'Freigegeben',
}

/** While an operation runs, it says more than the status it will end in. */
export const PENDING_OPERATION_LABELS: Record<string, string> = {
    CREATE: 'Wird freigegeben …',
    UPDATE: 'Wird aktualisiert …',
    UNRELEASE: 'Freigabe wird zurückgenommen …',
    DELETE: 'Wird gelöscht …',
}

/** The label for a dataset's state: a running operation first, else its status, else the raw value. */
export function datasetStatusLabel(status: string, pendingOperation?: string): string {
    return (
        (pendingOperation ? PENDING_OPERATION_LABELS[pendingOperation] : undefined) ??
        DATASET_STATUS_LABELS[status] ??
        status
    )
}
