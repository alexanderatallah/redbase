import { Database, redis } from '../src/database'
import { FakeRow, NUM_ROWS, BATCH_COUNT, randRows } from './shared'

async function main() {
  const db = new Database<FakeRow>('redis-benchmarking')

  // Insert
  await Promise.all(randRows(NUM_ROWS).map(row => db.set(row.uuid, row)))

  // Paginate
  for (let i = 0; i < NUM_ROWS; i += BATCH_COUNT) {
    await db.entries(undefined, i, BATCH_COUNT)
  }

  // Delete
  await db.clear()
  await redis.quit()
}

main().catch(e => console.error(e))
