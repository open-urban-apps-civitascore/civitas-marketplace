/**
 * The conversation with the language model: Anthropic's Messages API over
 * plain fetch (no SDK, this is a spike), with tools. `runConversation` keeps
 * calling while the model asks for READ tools and hands their results back;
 * it stops at the first plain answer or at the first call of a FINAL tool (a
 * proposal), which the caller turns into a plan card. ASSISTANT_MODEL
 * overrides the model.
 */

export interface ChatTurn {
    role: 'user' | 'assistant'
    content: string
}

export interface ToolSpec {
    name: string
    description: string
    input_schema: Record<string, unknown>
}

type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

interface ApiMessage {
    role: 'user' | 'assistant'
    content: string | ContentBlock[]
}

export interface ConversationResult {
    text: string
    /** The final tool the model chose, with its input. */
    final?: { name: string; input: unknown }
    /** Read tools used on the way, for the chat to show what was looked up. */
    lookups: string[]
}

/** A read tool answers with text the model reads; it must not throw for a wrong input. */
export type ReadTool = ToolSpec & { run: (input: unknown) => Promise<string> }

const MAX_ROUNDS = 6

async function callModel(system: string, messages: ApiMessage[], tools: ToolSpec[]): Promise<ContentBlock[]> {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) throw new Error('Kein Schlüssel für das Sprachmodell: ANTHROPIC_API_KEY in .env.local setzen.')
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            model: process.env.ASSISTANT_MODEL || 'claude-sonnet-5-5',
            max_tokens: 8192,
            system,
            messages,
            tools,
        }),
        cache: 'no-store',
    })
    if (!response.ok) {
        throw new Error(`Anthropic ${response.status}: ${(await response.text()).slice(0, 300)}`)
    }
    const body = (await response.json()) as { content: ContentBlock[] }
    return body.content
}

export async function runConversation(
    system: string,
    turns: ChatTurn[],
    readTools: ReadTool[],
    finalTools: ToolSpec[],
): Promise<ConversationResult> {
    const messages: ApiMessage[] = turns.map((turn) => ({ role: turn.role, content: turn.content }))
    const tools: ToolSpec[] = [
        ...readTools.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
        ...finalTools,
    ]
    const lookups: string[] = []
    const texts: string[] = []

    for (let round = 0; round < MAX_ROUNDS; round++) {
        const content = await callModel(system, messages, tools)
        for (const block of content) {
            if (block.type === 'text' && block.text.trim()) texts.push(block.text.trim())
        }
        const uses = content.filter((block): block is Extract<ContentBlock, { type: 'tool_use' }> => block.type === 'tool_use')

        const final = uses.find((use) => finalTools.some((tool) => tool.name === use.name))
        if (final) return { text: texts.join('\n\n'), final: { name: final.name, input: final.input }, lookups }
        if (uses.length === 0) return { text: texts.join('\n\n'), lookups }

        // Read tools: run them, hand the results back, and ask again.
        messages.push({ role: 'assistant', content })
        const results: ContentBlock[] = []
        for (const use of uses) {
            const tool = readTools.find((candidate) => candidate.name === use.name)
            lookups.push(use.name)
            try {
                const output = tool ? await tool.run(use.input) : `Unbekanntes Werkzeug ${use.name}`
                results.push({ type: 'tool_result', tool_use_id: use.id, content: output.slice(0, 20000) })
            } catch (error) {
                results.push({
                    type: 'tool_result',
                    tool_use_id: use.id,
                    content: error instanceof Error ? error.message : String(error),
                    is_error: true,
                })
            }
        }
        messages.push({ role: 'user', content: results })
    }
    return { text: [...texts, '(Abgebrochen: zu viele Nachschlage-Schritte.)'].join('\n\n'), lookups }
}
