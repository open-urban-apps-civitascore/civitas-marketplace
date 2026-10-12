'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * The assistant's text as formatted Markdown: lists, bold, code and tables
 * (GitHub flavour). Links open in a new tab, so a catalogue entry the assistant
 * names opens beside the chat instead of replacing it.
 *
 * With `onChoose`, the items of a NUMBERED list become choices: the assistant
 * writes options as numbered lists and everything else with bullets, so a
 * click on an item answers with that option.
 */
const COMPONENTS: Components = {
    a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">
            {children}
        </a>
    ),
    p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
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

/** Whether the list item being rendered sits in a numbered list. */
const InOrderedList = createContext(false)

/** The plain text of a Markdown syntax node, for the answer a click sends. */
function textOf(node: unknown): string {
    if (!node || typeof node !== 'object') return ''
    const { type, value, children } = node as { type?: string; value?: unknown; children?: unknown[] }
    if (type === 'text' && typeof value === 'string') return value
    return Array.isArray(children) ? children.map(textOf).join('') : ''
}

function ListItem({
    node,
    onChoose,
    children,
}: {
    node: unknown
    onChoose?: (choice: string) => void
    children: ReactNode
}) {
    const ordered = useContext(InOrderedList)
    if (!ordered || !onChoose) return <li>{children}</li>
    const choice = textOf(node).trim()
    return (
        <li
            role="button"
            tabIndex={0}
            onClick={() => onChoose(choice)}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onChoose(choice)
                }
            }}
            // The number stays the list marker: it sits outside the box, so "2" can still be typed as the answer.
            className="relative cursor-pointer rounded-md border border-primary/30 bg-primary/5 py-2 pl-3 pr-9 transition-colors marker:font-semibold marker:text-primary hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Diese Option wählen"
        >
            {children}
            <ArrowRight aria-hidden className="absolute right-3 top-2.5 size-4 text-primary" />
        </li>
    )
}

export function ChatMarkdown({ text, onChoose }: { text: string; onChoose?: (choice: string) => void }) {
    const components: Components = {
        ...COMPONENTS,
        ol: ({ children }) => (
            <InOrderedList.Provider value={true}>
                <ol className={`mb-2 list-decimal pl-5 last:mb-0 ${onChoose ? 'space-y-2' : 'space-y-1'}`}>{children}</ol>
            </InOrderedList.Provider>
        ),
        ul: ({ children }) => (
            <InOrderedList.Provider value={false}>
                <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
            </InOrderedList.Provider>
        ),
        li: ({ node, children }) => (
            <ListItem node={node} onChoose={onChoose}>
                {children}
            </ListItem>
        ),
    }
    return (
        <div className="text-sm">
            <Markdown remarkPlugins={[remarkGfm]} components={components}>
                {text}
            </Markdown>
        </div>
    )
}
