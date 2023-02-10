import http from 'http'
import { Database } from './database'

const hostname = '127.0.0.1'
const port = parseInt(process.env['PORT'] || '3000')
const args = process.argv.slice(2)
const databaseName = args[0]
if (!databaseName) {
  throw new Error('Provide a database name')
}
const db = new Database<unknown>(databaseName)

export type Response<ValueT> = {
  actions: Record<string, string>
  entries: { id: string; 'delete this': string; value: ValueT }[]
}

const ENTRY_PREFIX = '/entry/'

async function respondTo(req: http.IncomingMessage, res: http.ServerResponse) {
  const host = `http://${req.headers.host || ''}`
  const url = new URL(req.url || '', host)
  const tagPath = url.pathname.slice(1)
  const offset = parseInt(url.searchParams.get('offset') || '0')
  const shouldDelete = url.searchParams.get('method') === 'DELETE'
  console.log(
    `Requesting ${shouldDelete ? 'delete' : 'browse'} on path: ${tagPath}`
  )

  if (shouldDelete) {
    return handleDelete(req, res)
  }

  const absolutePath = host + tagPath
  const entries = await db.filter({
    where: tagPath,
    offset: offset,
    limit: 40,
    ordering: 'desc',
  })
  const subTags = await db.tags({ where: tagPath })
  const count = await db.count({ where: tagPath })

  // Create actions for the UI
  const actions: Record<string, string> = {
    [`delete all ${count}`]: absolutePath + '/' + tagPath + '?method=DELETE',
  }
  for (const subTag of subTags) {
    const tagParts = subTag.split('/')
    const label = 'browse ' + decodeURIComponent(tagParts[tagParts.length - 1])
    actions[label] = absolutePath + '/' + subTag
  }

  return {
    total: count,
    actions,
    entries: entries.map(e => ({
      'delete this': absolutePath + ENTRY_PREFIX + e.id + '?method=DELETE',
      ...e,
    })),
  }
}

async function handleDelete(
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  const host = `http://${req.headers.host || ''}`
  const url = new URL(req.url || '', host)
  const tagPath = url.pathname.slice(1)
  const entryPrefix = ENTRY_PREFIX.substring(1)
  res.statusCode = 307
  if (tagPath.startsWith(entryPrefix)) {
    // Deleting a single entry
    await db.delete(tagPath.substring(entryPrefix.length))
    res.setHeader('Location', '/')
  } else {
    // Deleting many
    await db.clear({ where: tagPath })
    res.setHeader('Location', '/' + tagPath)
  }
  return null
}

// Server setup

// eslint-disable-next-line @typescript-eslint/no-misused-promises
export const server = http.createServer(async (req, res) => {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  const json = await respondTo(req, res)
  res.end(JSON.stringify(json))
})

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`)
})
