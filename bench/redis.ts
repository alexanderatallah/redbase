import { Database, redis } from '../src/database'
import {
  FakeRow,
  INSERTION_BATCH,
  SCROLL_BATCH,
  randRows,
  DO_INSERT,
  DO_SCROLL,
  DO_DELETE,
  DO_SETUP,
  SCROLL_INDEXED,
  SCROLL_MULTIINDEXED,
} from './shared'

async function setupRedis(db: Database<FakeRow>) {
  // Put Redis in a closer fsync/write mode to Postgres
  await Promise.all([
    redis.config('SET', 'appendonly', 'yes'),
    redis.config('SET', 'appendfsync', 'everysec'),
    // Use the always setting for worse performance, but it's equivalent to Postgres's default level of persistence
    // redis.config('SET', 'appendfsync', 'always'),
  ])

  const deletions = await db.clear()
  console.log('Deleted from redis: ', deletions)
}

async function main() {
  const db = new Database<FakeRow>('redis-benchmarking')

  if (DO_SETUP) {
    await setupRedis(db)
  }

  if (DO_INSERT) {
    // Insert
    await Promise.all(
      randRows(INSERTION_BATCH).map(row =>
        db.save(row.uuid, row, {
          tags: [`projectId/${row.projectId}`, `categoryId/${row.categoryId}`],
          sortBy: val => val.date.getTime(),
        })
      )
    )
  }

  if (DO_SCROLL) {
    const where = SCROLL_MULTIINDEXED
      ? { OR: ['projectId/1', 'categoryId/1'] }
      : SCROLL_INDEXED
      ? 'categoryId/1'
      : {}
    // Paginate
    const rowCount = await db.count({ where })
    console.log('rowCount redis', rowCount)

    for (let i = 0; i < rowCount; i += SCROLL_BATCH) {
      await db.filter({ where, offset: i, limit: SCROLL_BATCH })
    }
  }

  if (DO_DELETE) {
    // Delete
    await db.clear()
  }
  await redis.quit()
}

main().catch(e => console.error(e))
