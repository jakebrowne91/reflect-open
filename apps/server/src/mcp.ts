import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { GraphService } from './graph-service'

/**
 * The MCP face of {@link GraphService}: the same operations the REST routes
 * expose, as typed tools an agent discovers at connect time. Servers are
 * built per-request (stateless Streamable HTTP) — the graph service behind
 * them is the shared singleton, so there is no per-session state to lose.
 */
export function buildMcpServer(graph: GraphService): McpServer {
  const server = new McpServer({ name: 'reflect-graph', version: '0.1.0' })

  const asText = (value: unknown): { content: [{ type: 'text'; text: string }] } => ({
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  })

  const pathArg = z
    .string()
    .describe('Graph-relative note path, e.g. "notes/some-title.md" or "daily/2026-07-15.md"')

  server.registerTool(
    'list_notes',
    {
      description:
        'List every note in the graph (path, title, kind, last-modified), newest first.',
    },
    async () => asText(graph.listNotes()),
  )

  server.registerTool(
    'read_note',
    {
      description: 'Read a note’s full markdown by path.',
      inputSchema: { path: pathArg },
    },
    async ({ path }) => asText((await graph.readNote(path)).contents),
  )

  server.registerTool(
    'write_note',
    {
      description:
        'Replace a note’s markdown entirely (create it if missing). The index updates immediately.',
      inputSchema: { path: pathArg, contents: z.string().describe('Full markdown contents') },
    },
    async ({ path, contents }) => asText(await graph.writeNote(path, contents)),
  )

  server.registerTool(
    'create_note',
    {
      description:
        'Create a new note. Give a title (the path is derived, like the app does) or an explicit path. Fails rather than overwriting.',
      inputSchema: {
        title: z.string().optional().describe('Note title; becomes notes/<slug>.md'),
        path: pathArg.optional(),
        contents: z.string().default('').describe('Initial markdown contents'),
      },
    },
    async ({ title, path, contents }) => asText(await graph.createNote({ title, path, contents })),
  )

  server.registerTool(
    'delete_note',
    {
      description: 'Delete a note by path. Irreversible (no trash on the server).',
      inputSchema: { path: pathArg },
    },
    async ({ path }) => {
      await graph.deleteNote(path)
      return asText({ deleted: path })
    },
  )

  server.registerTool(
    'move_note',
    {
      description: 'Rename/move a note. Refuses when the destination already exists.',
      inputSchema: { from: pathArg, to: pathArg },
    },
    async ({ from, to }) => {
      await graph.moveNote(from, to)
      return asText({ from, to })
    },
  )

  server.registerTool(
    'search',
    {
      description:
        'Full-text search across all notes (FTS5). Returns paths, titles, and highlighted snippets.',
      inputSchema: {
        query: z.string().describe('Search terms'),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async ({ query, limit }) => asText(graph.search(query, limit)),
  )

  server.registerTool(
    'today',
    {
      description:
        'Get today’s daily note: its path and contents (contents is null when it doesn’t exist yet).',
    },
    async () => asText(graph.today()),
  )

  server.registerTool(
    'append_today',
    {
      description:
        'Append a markdown block to today’s daily note, creating it if needed. The standard way to log something.',
      inputSchema: { text: z.string().describe('Markdown to append') },
    },
    async ({ text }) => asText(await graph.appendToday(text)),
  )

  server.registerTool(
    'open_tasks',
    {
      description:
        'List every open task ("+ [ ]" checkbox) across the graph with its note and due date.',
    },
    async () => asText(graph.openTasks()),
  )

  return server
}
