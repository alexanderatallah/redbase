import { faker } from '@faker-js/faker'
// faker.seed(123)

const args = process.argv.slice(2)

export const SKIP_INSERT = args.includes('SKIP_INSERT')
export const SKIP_SCROLL = args.includes('SKIP_SCROLL')
export const SKIP_DELETE = args.includes('SKIP_DELETE')
export const DO_SETUP = args.includes('DO_SETUP')
export const INSERTION_BATCH = 50_000 // Increasing this slows down Postgres
export const SCROLL_BATCH = 500

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
