'use client'

import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * The assistant's text as formatted Markdown: lists, bold, code and tables
 * (GitHub flavour). Links open in a new tab, so a catalogue entry the assistant
 * names opens beside the chat instead of replacing it.
 */
const COMPONENTS: Components = {
    a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">
            {children}
        </a>
    ),
    p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
    ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
    ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>,
    h1: ({ children }) => <p className="mb-1 mt-3 font-semibold">{children}</p>,
    h2: ({ children }) => <p className="mb-1 mt-3 font-semibold">{children}</p>,
    h3: ({ children }) => <p className="mb-1 mt-3 font-semibold">{children}</p>,
    table: ({ children }) => (
        <div className="mb-2 overflow-x-auto">
            <table className="w-full border-collapse text-xs">{children}</table>
        </div>
    ),
    th: ({ children }) => <th className="border-b px-2 py-1 text-left font-semibold">{children}</th>,
    td: ({ children }) => <td className="border-b px-2 py-1 align-top">{children}</td>,
}

export function ChatMarkdown({ text }: { text: string }) {
    return (
        <div className="text-sm">
            <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
                {text}
            </Markdown>
        </div>
    )
}
