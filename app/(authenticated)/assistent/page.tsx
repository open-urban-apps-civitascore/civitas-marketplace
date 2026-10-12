import { AssistantChat } from '@/components/assistant/assistant-chat'
import { isAssistantConfigured } from '@/lib/assistant/config'
import { requireSession } from '@/lib/session'

export default async function AssistantPage() {
    await requireSession()

    if (!isAssistantConfigured()) {
        return (
            <div className="flex flex-col gap-2">
                <h1>Assistent</h1>
                <p className="text-sm text-muted-foreground">
                    Der Assistent ist auf dieser Instanz nicht eingerichtet: Es ist kein Schlüssel für ein Sprachmodell
                    hinterlegt (<code>ANTHROPIC_API_KEY</code>).
                </p>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1>Assistent</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Fragen zum Katalog stellen oder eigene Daten beschreiben. Der Assistent schlägt einen
                    Plan vor; angelegt wird erst nach der Bestätigung, über denselben Installationsweg wie
                    ein Paket aus dem Katalog.
                </p>
            </div>
            <AssistantChat />
        </div>
    )
}
