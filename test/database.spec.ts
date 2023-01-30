import { Database, redis } from '../src'
import { v4 as uuidv4 } from 'uuid'

describe('Database', () => {
  type ValueT = { answer: string; optional?: number[] }

  let db: Database<string>
  let dbComplex: Database<ValueT>

  beforeAll(() => {
    db = new Database<string>('Test')
    dbComplex = new Database<ValueT>('TestComplex')
  })

  afterAll(async () => {
    await db.clear()
    await dbComplex.clear()
    redis.disconnect()
  })

  describe('static properties', () => {
    it('should have a name getter', () => {
      expect(db.name).toBe('Test')
      expect(dbComplex.name).toBe('TestComplex')
    })

    it('shoudl not have a name setter', () => {
      // @ts-ignore
      expect(() => (db.name = 'Test')).toThrowError()
    })
  })

  describe('single get/set/delete', () => {
    let uuid: string

    afterAll(async () => {
      await db.clear()
      await dbComplex.clear()
    })

    it('should be able to set values', async () => {
      uuid = uuidv4()
      await db.set(uuid, 'bar')
      expect(await db.get(uuid)).toBe('bar')

      await dbComplex.set(uuid, { answer: 'bar' })
      expect(await dbComplex.get(uuid)).toEqual({
        answer: 'bar',
      })
    })

    it('should not get unknown values', async () => {
      expect(await db.get(uuidv4())).toBe(undefined)
      expect(await dbComplex.get(uuidv4())).toBe(undefined)
    })

    it('should be able to delete entries', async () => {
      await db.del(uuid)
      expect(await db.get(uuid)).toBe(undefined)
    })
  })

  describe('query entries', () => {
    let uuids: string[]

    beforeAll(async () => {
      uuids = [uuidv4(), uuidv4(), uuidv4(), uuidv4()]
      await db.set(uuids[0], 'bar')
      await db.set(uuids[1], 'qux')
      await db.set(uuids[2], 'power')
      await dbComplex.set(uuids[3], { answer: 'bar' })
    })

    afterAll(async () => {
      await db.clear()
      await dbComplex.clear()
    })

    it('should be able to list entries', async () => {
      const data = await db.entries()
      expect(data).toEqual([
        {
          id: uuids[2],
          value: 'power',
        },
        {
          id: uuids[1],
          value: 'qux',
        },
        {
          id: uuids[0],
          value: 'bar',
        },
      ])

      const complexData = await dbComplex.entries()
      expect(complexData).toEqual([
        {
          id: uuids[3],
          value: { answer: 'bar' },
        },
      ])
    })

    it('should be able to paginate entries', async () => {
      let data = await db.entries(undefined, 0, 2)
      expect(data).toEqual([
        {
          id: uuids[2],
          value: 'power',
        },
        {
          id: uuids[1],
          value: 'qux',
        },
      ])

      data = await db.entries(undefined, 2, 2)
      expect(data).toEqual([
        {
          id: uuids[0],
          value: 'bar',
        },
      ])
    })
  })
})
