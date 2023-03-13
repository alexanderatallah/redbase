import { Redbase } from './redbase'

const port = parseInt(process.env['BROWSER_PORT'] || '3000')
const args = process.argv.slice(2)
const databaseName = args[0]
if (!databaseName) {
  throw new Error('Provide a database name')
}
const db = new Redbase<unknown>(databaseName)

const ENTRY_PREFIX = '/entry/'
const PAGE_SIZE = 40

async function handleBrowse(url: URL) {
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

  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function handleDelete(url: URL) {
  const tagPath = url.pathname.slice(1)
  const entryPrefix = ENTRY_PREFIX.substring(1)
  let header
  if (tagPath.startsWith(entryPrefix)) {
    // Deleting a single entry
    await db.delete(tagPath.substring(entryPrefix.length))
    header = { Location: '/' }
  } else {
    // Deleting many
    await db.clear({ where: tagPath })
    header = { Location: '/' + tagPath }
  }
  return new Response(undefined, {
    status: 307,
    headers: header,
  })
}

const server = Bun.serve({
  fetch(req: Request) {
    const url = new URL(req.url || '')

    const shouldDelete = url.searchParams.get('method') === 'DELETE'
    console.log(
      `Requesting ${shouldDelete ? 'delete' : 'browse'} on path: ${
        url.pathname
      }`
    )

    if (shouldDelete) {
      return handleDelete(url)
    } else {
      return handleBrowse(url)
    }
  },

  // baseURI: "http://localhost:3000",

  // this is called when fetch() throws or rejects
  // error(err: Error) {
  //   return new Response("uh oh! :(\n" + err.toString(), { status: 500 });
  // },

  // this boolean enables bun's default error handler
  development: false,
  // note: this isn't node, but for compatibility bun supports process.env + more stuff in process

  // SSL is enabled if these two are set
  // certFile: './cert.pem',
  // keyFile: './key.pem',

  port, // number or string
})

console.log(`Listening on http://localhost:${server.port}...`)
