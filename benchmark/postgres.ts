import { Client } from 'pg'
import {
  randRows,
  NUM_ROWS,
  BATCH_COUNT,
  FakeRow,
  SKIP_INSERT,
  SKIP_DELETE,
  SKIP_SCROLL,
} from './shared'

const client = new Client({
  host: 'localhost',
  user: 'postgres',
  password: 'postgres',
  database: 'redis_benchmarking', // TODO script to create this ahead of time
})

async function setupSchema() {
  return client.query(`
    CREATE TABLE IF NOT EXISTS fake_rows (
      uuid TEXT PRIMARY KEY,
      name TEXT,
      tags TEXT[],
      date TIMESTAMP,
      text TEXT
    );

    CREATE INDEX IF NOT EXISTS fake_rows_date_idx ON fake_rows (date);
  `)
}

async function main() {
  await client.connect()
  await setupSchema()

  if (!SKIP_INSERT) {
    // Insert each

    await Promise.all(
      randRows(NUM_ROWS).map(row =>
        client.query(
          `
        INSERT INTO fake_rows (uuid, name, tags, date, text)
        VALUES ($1, $2, $3, $4, $5);
      `,
          [row.uuid, row.name, row.tags, row.date, row.text]
        )
      )
    )
  }

  if (!SKIP_SCROLL) {
    // Paginate
    const rowCount = await client.query(`
      SELECT COUNT(*) FROM fake_rows;
    `)
    const count = (rowCount.rows[0] as { count: number }).count
    console.log('rowCount postgres', count)

    for (let i = 0; i < count; i += BATCH_COUNT) {
      await client.query(
        `
      SELECT * FROM fake_rows ORDER BY date DESC OFFSET $1 LIMIT $2
    `,
        [i, BATCH_COUNT]
      )
    }
  }

  if (!SKIP_DELETE) {
    // Delete each after a select: same way as the redis client
    const res = await client.query(`
        SELECT uuid FROM fake_rows ORDER BY date DESC
      `)
    await Promise.all(
      res.rows.map(async (row: FakeRow) => {
        return client.query(
          `
        DELETE FROM fake_rows WHERE uuid = $1
      `,
          [row.uuid]
        )
      })
    )

    // Clear table and indexes, to match what redis does
    await client.query(`
      DROP TABLE fake_rows;
    `)
  }

  await client.end()
}

main().catch(e => console.error(e))
