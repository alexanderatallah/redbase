import { Client } from 'pg'
import { randRows, NUM_ROWS, BATCH_COUNT, FakeRow } from './shared'
const client = new Client({
  host: 'localhost',
  user: 'postgres',
  password: 'postgres',
  database: 'redis_benchmarking', // TODO script to create this ahead of time
})

async function main() {
  await client.connect()

  await client.query(`
    DROP TABLE IF EXISTS fake_rows;

    CREATE TABLE fake_rows (
      uuid TEXT PRIMARY KEY,
      name TEXT,
      tags TEXT[],
      date TIMESTAMP,
      text TEXT
    );

    CREATE INDEX fake_rows_date_idx ON fake_rows (date);
  `)

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

  // Paginate
  for (let i = 0; i < NUM_ROWS; i += BATCH_COUNT) {
    await client.query(
      `
    SELECT * FROM fake_rows ORDER BY date DESC OFFSET $1 LIMIT $2
  `,
      [i, BATCH_COUNT]
    )
  }

  // Delete each after a select: same way as the redis client
  await Promise.all(
    Array.from({ length: NUM_ROWS }).map(async () => {
      const res = await client.query(`
      SELECT uuid FROM fake_rows ORDER BY date DESC LIMIT 1
    `)
      const firstRow = res.rows[0] as FakeRow
      return client.query(
        `
      DELETE FROM fake_rows WHERE uuid = $1
    `,
        [firstRow.uuid]
      )
    })
  )

  // Clear table and indexes, to match what redis does
  await client.query(`
    DROP TABLE fake_rows;
  `)

  await client.end()
}

main().catch(e => console.error(e))
