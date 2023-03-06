import http from 'http'
import { Redbase } from './database'

const hostname = '127.0.0.1'
const port = parseInt(process.env['BROWSER_PORT'] || '3000')
const args = process.argv.slice(2)
const databaseName = args[0]
if (!databaseName) {
  throw new Error('Provide a database name')
}
const db = new Redbase<unknown>(databaseName)

const ENTRY_PREFIX = '/entry/'
const PAGE_SIZE = 40

async function handleBrowse(
  url: URL,
  _req: http.IncomingMessage,
  res: http.ServerResponse
) {
  const host = `${url.protocol}//${url.host}`
  const tagPath = url.pathname.slice(1)
  const offset = parseInt(url.searchParams.get('offset') || '0')
  const absolutePath = host + '/' + tagPath
  const entries = await db.filter({
    where: tagPath,
    offset: offset,
    limit: PAGE_SIZE,
    ordering: 'desc',
  })
  const subTags = await db.tags({ where: tagPath })
  const count = await db.count({ where: tagPath })

  // Create actions for the UI
  const actions: Record<string, string> = {
    [`delete all ${count}`]: absolutePath + '?method=DELETE',
  }
  if (tagPath) {
    actions['back to root'] = host
  }
  if (count > offset + PAGE_SIZE) {
    actions[`next ${PAGE_SIZE}`] =
      absolutePath + `?offset=${offset + PAGE_SIZE}`
    actions[`last ${PAGE_SIZE}`] = absolutePath + `?offset=${count - PAGE_SIZE}`
  }
  if (offset > 0) {
    actions[`prev ${PAGE_SIZE}`] =
      absolutePath + `?offset=${Math.max(offset - PAGE_SIZE, 0)}`
  }
  for (const subTag of subTags) {
    const tagParts = subTag.split('/')
    const label = 'browse ' + decodeURIComponent(tagParts[tagParts.length - 1])
    actions[label] = absolutePath + subTag
  }

  const json = {
    total: count,
    actions,
    entries: entries.map(e => ({
      'delete this': absolutePath + ENTRY_PREFIX + e.id + '?method=DELETE',
      ...e,
    })),
  }
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(json))
}

async function handleDelete(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
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
  return res.end()
}

// Server setup and routes

// eslint-disable-next-line @typescript-eslint/no-misused-promises
export const server = http.createServer(async (req, res) => {
  const host = `http://${req.headers.host || ''}`
  const url = new URL(req.url || '', host)

  const shouldDelete = url.searchParams.get('method') === 'DELETE'
  console.log(
    `Requesting ${shouldDelete ? 'delete' : 'browse'} on path: ${url.pathname}`
  )

  if (shouldDelete) {
    return handleDelete(url, req, res)
  } else {
    return handleBrowse(url, req, res)
  }
})

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`)
})
