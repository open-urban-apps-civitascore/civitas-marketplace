/**
 * The parts of a use case's id, `urn:<publisher>:usecase:<name>`, apart from
 * the schema library, so a share page can check a short name without loading it.
 */
export const PUBLISHER_PATTERN = '[a-z0-9]{2,40}'

export const NAME_PATTERN = '[a-z0-9][a-z0-9-]{0,58}[a-z0-9]'

/** The `<name>` part on its own — the export validates its slug field with this. */
export const useCaseSlugPattern = new RegExp(`^${NAME_PATTERN}$`)
