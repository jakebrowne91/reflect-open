import { toAppError } from '@reflect/core'
import { Hono } from 'hono'
import { z } from 'zod'
import type { GraphService } from './graph-service'

const writeBodySchema = z.object({ path: z.string(), contents: z.string() })
const createBodySchema = z.object({
  path: z.string().optional(),
  title: z.string().optional(),
  contents: z.string().default(''),
})
const moveBodySchema = z.object({ from: z.string(), to: z.string() })
const appendBodySchema = z.object({ text: z.string() })

/**
 * The REST face of {@link GraphService}, mounted under `/api/agent` (inside
 * the auth middleware's `/api/*` scope — bearer token or session both work).
 * Boring JSON by design: everything an agent can do in one curl.
 */
export function createAgentRoutes(graph: GraphService): Hono {
  const app = new Hono()

  app.onError((cause, c) => {
    const error = toAppError(cause)
    return c.json({ error }, error.kind === 'notFound' ? 404 : 400)
  })

  app.get('/notes', (c) => c.json({ notes: graph.listNotes() }))

  app.get('/note', async (c) => {
    const path = c.req.query('path')
    if (path === undefined) {
      return c.json({ error: { kind: 'parse', message: 'path query param required' } }, 400)
    }
    return c.json(await graph.readNote(path))
  })

  app.put('/note', async (c) => {
    const body = writeBodySchema.parse(await c.req.json())
    return c.json(await graph.writeNote(body.path, body.contents))
  })

  app.post('/notes', async (c) => {
    const body = createBodySchema.parse(await c.req.json())
    return c.json(await graph.createNote(body), 201)
  })

  app.delete('/note', async (c) => {
    const path = c.req.query('path')
    if (path === undefined) {
      return c.json({ error: { kind: 'parse', message: 'path query param required' } }, 400)
    }
    await graph.deleteNote(path)
    return c.json({ deleted: path })
  })

  app.post('/note/move', async (c) => {
    const body = moveBodySchema.parse(await c.req.json())
    await graph.moveNote(body.from, body.to)
    return c.json({ from: body.from, to: body.to })
  })

  app.get('/search', (c) => {
    const query = c.req.query('q') ?? ''
    const limitRaw = Number(c.req.query('limit') ?? 20)
    const limit = Number.isFinite(limitRaw) ? limitRaw : 20
    return c.json({ hits: graph.search(query, limit) })
  })

  app.get('/today', (c) => c.json(graph.today()))

  app.post('/today/append', async (c) => {
    const body = appendBodySchema.parse(await c.req.json())
    return c.json(await graph.appendToday(body.text))
  })

  app.get('/tasks', (c) => c.json({ tasks: graph.openTasks() }))

  return app
}
