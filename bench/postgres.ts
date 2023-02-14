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
  SCROLL_INDEXED,
  SCROLL_MULTIINDEXED,
} from './shared'

const DATABASE_NAME = 'redis_benchmarking' // TODO script to create this ahead of time

const client = new Client({
  host: 'localhost',
  user: 'postgres',
  password: 'postgres',
  database: DATABASE_NAME,
})

async function setupSchema() {
  return client.query(`
    CREATE TABLE IF NOT EXISTS fake_rows (
      uuid TEXT PRIMARY KEY,
      name TEXT,
      tags TEXT[],
      date TIMESTAMP,
      text TEXT,
      projectId BIGINT,
      categoryId BIGINT
    );

    CREATE INDEX IF NOT EXISTS fake_rows_date_idx ON fake_rows (date);
    CREATE INDEX IF NOT EXISTS fake_rows_name_idx ON fake_rows (projectId);
    CREATE INDEX IF NOT EXISTS fake_rows_name_idx ON fake_rows (categoryId);
  `)
}

async function setupPostgres() {
  // Put Postgres in a closer fsync/write mode to Redis.
  // Set to "ON" (the default) if you want to compare to Redis's appendfsync=always setting.
  await client.query(
    `ALTER DATABASE ${DATABASE_NAME} SET synchronous_commit=OFF;`
  )
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
    const where = SCROLL_MULTIINDEXED
      ? 'WHERE projectId=1 or categoryId=1'
      : SCROLL_INDEXED
      ? 'WHERE categoryId=1'
      : ''
    // Paginate
    const rowCount = await client.query(`
      SELECT COUNT(*) FROM fake_rows ${where};
    `)
    const count = (rowCount.rows[0] as { count: number }).count
    console.log('rowCount postgres', count)

    for (let i = 0; i < count; i += SCROLL_BATCH) {
      await client.query(
        `
      SELECT * FROM fake_rows ${where} ORDER BY date DESC OFFSET $1 LIMIT $2
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
