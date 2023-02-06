import { faker } from '@faker-js/faker'
// faker.seed(123)

const args = process.argv.slice(2)

export const DO_INSERT = args.includes('DO_INSERT')
export const DO_SCROLL = args.includes('DO_SCROLL')
export const DO_DELETE = args.includes('DO_DELETE')
export const DO_SETUP = args.includes('DO_SETUP')
export const SCROLL_INDEXED = args.includes('SCROLL_INDEXED')
export const SCROLL_MULTIINDEXED = args.includes('SCROLL_MULTIINDEXED')
export const INSERTION_BATCH = 20_000
export const SCROLL_BATCH = 500

export type FakeRow = {
  uuid: string
  name: string
  tags: Array<number | string>
  projectId: number
  categoryId: number
  date: Date
  text: string
}

export function randRow(): FakeRow {
  return {
    uuid: faker.datatype.uuid(),
    name: faker.internet.userName(),
    tags: faker.datatype.array(10),
    projectId: faker.datatype.number(100),
    categoryId: faker.datatype.number(10),
    date: new Date(),
    text: faker.lorem.sentences(3), // Larger text blocks seem to slow down Redis
  }
}

export function randRows(count = 10): FakeRow[] {
  return Array.from({ length: count }).map(() => randRow())
}
