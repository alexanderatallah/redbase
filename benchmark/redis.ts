import { Database, redis } from '../src/database'
import {
  FakeRow,
  NUM_ROWS,
  BATCH_COUNT,
  randRows,
  SKIP_INSERT,
  SKIP_SCROLL,
  SKIP_DELETE,
} from './shared'

async function main() {
  const db = new Database<FakeRow>('redis-benchmarking')

  if (!SKIP_INSERT) {
    // Insert
    await Promise.all(randRows(NUM_ROWS).map(row => db.set(row.uuid, row)))
  }

  if (!SKIP_SCROLL) {
    // Paginate
    const rowCount = await db.count()
    console.log('rowCount redis', rowCount)

    for (let i = 0; i < rowCount; i += BATCH_COUNT) {
      await db.entries(undefined, i, BATCH_COUNT)
    }
  }

  if (!SKIP_DELETE) {
    // Delete
    await db.clear()
  }
  await redis.quit()
}

main().catch(e => console.error(e))
