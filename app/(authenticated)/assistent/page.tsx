import { AssistantChat } from '@/components/assistant/assistant-chat'
import { requireSession } from '@/lib/session'

export default async function AssistantPage() {
    await requireSession()

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
