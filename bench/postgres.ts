import { Client } from 'pg'
import {
  randRows,
  INSERTION_BATCH,
  SCROLL_BATCH,
  FakeRow,
  DO_INSERT,
  DO_SCROLL,
  DO_DELETE,
  DO_SETUP,
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
    CREATE INDEX IF NOT EXISTS fake_rows_name_idx ON fake_rows (name);
  `)
}

async function setupPostgres() {
  const result = await client.query(`
    DELETE FROM fake_rows;
  `)
  console.log('Deleted from postgres: ', result.rowCount)
}

async function main() {
  await client.connect()
  await setupSchema()

  if (DO_SETUP) {
    await setupPostgres()
  }

  if (DO_INSERT) {
    // Insert each

    await Promise.all(
      randRows(INSERTION_BATCH).map(row =>
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

  if (DO_SCROLL) {
    // Paginate
    const rowCount = await client.query(`
      SELECT COUNT(*) FROM fake_rows;
    `)
    const count = (rowCount.rows[0] as { count: number }).count
    console.log('rowCount postgres', count)

    for (let i = 0; i < count; i += SCROLL_BATCH) {
      await client.query(
        `
      SELECT * FROM fake_rows ORDER BY date DESC OFFSET $1 LIMIT $2
    `,
        [i, SCROLL_BATCH]
      )
    }
  }

  if (DO_DELETE) {
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
