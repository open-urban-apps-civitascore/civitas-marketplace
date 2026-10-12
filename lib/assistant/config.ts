/**
 * The assistant runs only where a model key is configured. Elsewhere it is not
 * offered at all: no menu entry, a page that says so, an endpoint that refuses.
 * So one image serves an instance with the assistant and one without.
 */
export function isAssistantConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY)
}
