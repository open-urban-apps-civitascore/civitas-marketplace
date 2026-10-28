// `urn:<publisher>:usecase:<name>`, apart from the schema library so share pages need not load it.
/** `SEGMENT` in lib/export-actions must match. */
export const PUBLISHER_PATTERN = '[a-z0-9]{2,40}'

export const NAME_PATTERN = '[a-z0-9][a-z0-9-]{0,58}[a-z0-9]'

export const useCaseSlugPattern = new RegExp(`^${NAME_PATTERN}$`)
