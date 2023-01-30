import { faker } from '@faker-js/faker'
faker.seed(123)

export const NUM_ROWS = parseInt(process.argv.slice(2)[0] || `${50_000}`) // Increasing this slows down Postgres
export const BATCH_COUNT = parseInt(process.argv.slice(2)[1] || `${100}`)

export type FakeRow = {
  uuid: string
  name: string
  tags: Array<number | string>
  date: Date
  text: string
}

export function randRow(): FakeRow {
  return {
    uuid: faker.datatype.uuid(),
    name: faker.internet.userName(),
    tags: faker.datatype.array(10),
    date: new Date(),
    text: faker.lorem.sentences(3), // Larger text blocks seem to slow down Redis
  }
}

export function randRows(count = 10): FakeRow[] {
  return Array.from({ length: count }).map(() => randRow())
}
