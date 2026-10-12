import { createAgentUIStreamResponse } from 'ai'

import { buildAssistantAgent } from '@/lib/assistant/agent'
import { requireSession } from '@/lib/session'

/**
 * The assistant's chat endpoint: the conversation in, the answer streamed back
 * as UI message parts (text, lookups, plan cards). Read tools run with the
 * signed-in user's token, so the assistant sees what the person may see.
 */
export async function POST(request: Request) {
    await requireSession()
    const body = (await request.json()) as { messages?: unknown[] }
    return createAgentUIStreamResponse({
        agent: await buildAssistantAgent(),
        uiMessages: body.messages ?? [],
        // A local spike: show the real reason instead of a generic message.
        onError: (error) => (error instanceof Error ? error.message : String(error)),
    })
}
