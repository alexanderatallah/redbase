import { Database, redis } from '../src/database'
import {
  FakeRow,
  INSERTION_BATCH,
  SCROLL_BATCH,
  randRows,
  SKIP_INSERT,
  SKIP_SCROLL,
  SKIP_DELETE,
  DO_SETUP,
} from './shared'

async function setupRedis(db: Database<FakeRow>) {
  // Put Redis in the same fsync/write mode as Postgres
  await Promise.all([
    redis.config('SET', 'appendonly', 'yes'),
    redis.config('SET', 'appendfsync', 'always'),
  ])

  const deletions = await db.clear()
  console.log('Deleted from redis: ', deletions.length)
}

async function main() {
  const db = new Database<FakeRow>('redis-benchmarking')

  if (DO_SETUP) {
    await setupRedis(db)
    await redis.quit()
    return
  }

  if (!SKIP_INSERT) {
    // Insert
    await Promise.all(
      randRows(INSERTION_BATCH).map(row => db.save(row.uuid, row))
    )
  }

  if (!SKIP_SCROLL) {
    // Paginate
    const rowCount = await db.count()
    console.log('rowCount redis', rowCount)

    for (let i = 0; i < rowCount; i += SCROLL_BATCH) {
      await db.filter({ offset: i, limit: SCROLL_BATCH })
    }
  }

  if (!SKIP_DELETE) {
    // Delete
    await db.clear()
  }
  await redis.quit()
}

main().catch(e => console.error(e))
