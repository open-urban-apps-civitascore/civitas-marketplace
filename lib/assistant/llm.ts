/**
 * One call to a language model, with the proposal tool offered. Anthropic by
 * default; with only OPENAI_API_KEY set, OpenAI. Plain fetch, no SDK: this is a
 * demo spike and should not add dependencies. ASSISTANT_MODEL overrides the
 * model of either provider.
 */

export interface ChatTurn {
    role: 'user' | 'assistant'
    content: string
}

export interface ModelAnswer {
    text: string
    /** The proposal tool's input, when the model chose to call it. */
    toolInput?: unknown
}

export const TOOL_NAME = 'datenstruktur_vorschlagen'

const TOOL_DESCRIPTION =
    'Schlägt eine neue Datenstruktur für CIVITAS/CORE vor. Nur aufrufen, wenn die Person eigene Daten beschreibt, die angelegt werden sollen, und kein Katalog-Eintrag passt oder sie ausdrücklich etwas Eigenes will.'

export async function callModel(
    system: string,
    turns: ChatTurn[],
    toolSchema: Record<string, unknown>,
): Promise<ModelAnswer> {
    if (process.env.ANTHROPIC_API_KEY) return callAnthropic(system, turns, toolSchema)
    if (process.env.OPENAI_API_KEY) return callOpenAI(system, turns, toolSchema)
    throw new Error('Kein Schlüssel für ein Sprachmodell: ANTHROPIC_API_KEY oder OPENAI_API_KEY in .env.local setzen.')
}

async function callAnthropic(
    system: string,
    turns: ChatTurn[],
    toolSchema: Record<string, unknown>,
): Promise<ModelAnswer> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            model: process.env.ASSISTANT_MODEL || 'claude-sonnet-5-5',
            max_tokens: 4096,
            system,
            messages: turns,
            tools: [{ name: TOOL_NAME, description: TOOL_DESCRIPTION, input_schema: toolSchema }],
        }),
        cache: 'no-store',
    })
    if (!response.ok) {
        throw new Error(`Anthropic ${response.status}: ${(await response.text()).slice(0, 300)}`)
    }
    const body = (await response.json()) as {
        content: { type: string; text?: string; name?: string; input?: unknown }[]
    }
    const text = body.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('\n')
        .trim()
    const tool = body.content.find((block) => block.type === 'tool_use' && block.name === TOOL_NAME)
    return { text, toolInput: tool?.input }
}

async function callOpenAI(
    system: string,
    turns: ChatTurn[],
    toolSchema: Record<string, unknown>,
): Promise<ModelAnswer> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            model: process.env.ASSISTANT_MODEL || 'gpt-4.1',
            messages: [{ role: 'system', content: system }, ...turns],
            tools: [
                {
                    type: 'function',
                    function: { name: TOOL_NAME, description: TOOL_DESCRIPTION, parameters: toolSchema },
                },
            ],
        }),
        cache: 'no-store',
    })
    if (!response.ok) {
        throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 300)}`)
    }
    const body = (await response.json()) as {
        choices: {
            message: {
                content?: string | null
                tool_calls?: { function: { name: string; arguments: string } }[]
            }
        }[]
    }
    const message = body.choices[0]?.message
    const call = message?.tool_calls?.find((candidate) => candidate.function.name === TOOL_NAME)
    return {
        text: message?.content?.trim() ?? '',
        toolInput: call ? JSON.parse(call.function.arguments) : undefined,
    }
}
