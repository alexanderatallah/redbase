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

  describe('single get/set/del', () => {
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

      await dbComplex.del(uuid)
      expect(await dbComplex.get(uuid)).toBe(undefined)
    })
  })

  describe('list and count entries', () => {
    let uuids: string[]

    beforeAll(async () => {
      uuids = [uuidv4(), uuidv4(), uuidv4(), uuidv4()]
      await db.set(uuids[0], 'bar')
      // Wait 10ms prevent pipelining
      await new Promise(resolve => setTimeout(resolve, 10))
      await db.set(uuids[1], 'qux')
      await new Promise(resolve => setTimeout(resolve, 10))
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
          id: uuids[0],
          value: 'bar',
        },
        {
          id: uuids[1],
          value: 'qux',
        },
        {
          id: uuids[2],
          value: 'power',
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

    it('should be able to reverse entries', async () => {
      const data = await db.entries({ ordering: 'desc' })
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
    })

    it('should be able to count entries', async () => {
      expect(await db.count()).toBe(3)
      expect(await dbComplex.count()).toBe(1)
    })

    it('should be able to paginate entries', async () => {
      let data = await db.entries({ limit: 2 })
      expect(data).toEqual([
        {
          id: uuids[0],
          value: 'bar',
        },
        {
          id: uuids[1],
          value: 'qux',
        },
      ])

      data = await db.entries({ limit: 2, offset: 2 })
      expect(data).toEqual([
        {
          id: uuids[2],
          value: 'power',
        },
      ])
    })
  })

  describe.skip('index hierarchical entries', () => {
    // WIP
    // let uuids: string[]
    // beforeAll(async () => {
    //   uuids = [uuidv4(), uuidv4(), uuidv4(), uuidv4()]
    //   await db.set(uuids[0], 'bar')
    //   await db.set(uuids[1], 'qux')
    //   await db.set(uuids[2], 'power')
    // })
  })

  describe('index and query entries', () => {
    let uuids: string[]

    beforeAll(async () => {
      uuids = [uuidv4(), uuidv4(), uuidv4(), uuidv4(), uuidv4(), uuidv4()]
      for (let i = 0; i < uuids.length; i++) {
        await db.set(uuids[i], `key ${i}`, [`mod3_${i % 3}`, `mod2_${i % 2}`])
        // Wait 10ms prevent pipelining
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    })

    afterAll(async () => {
      await db.clear()
    })

    it('should be able to query all entries', async () => {
      const data = await db.entries()
      expect(data).toStrictEqual([
        {
          id: uuids[0],
          value: 'key 0',
        },
        {
          id: uuids[1],
          value: 'key 1',
        },
        {
          id: uuids[2],
          value: 'key 2',
        },
        {
          id: uuids[3],
          value: 'key 3',
        },
        {
          id: uuids[4],
          value: 'key 4',
        },
        {
          id: uuids[5],
          value: 'key 5',
        },
      ])
    })

    it('should be able to query individual indexes', async () => {
      const data = await db.entries({ where: { AND: ['mod3_0'] } })
      expect(data).toStrictEqual([
        {
          id: uuids[0],
          value: 'key 0',
        },
        {
          id: uuids[3],
          value: 'key 3',
        },
      ])

      const data2 = await db.entries({ where: { AND: ['mod2_0'] } })
      expect(data2).toStrictEqual([
        {
          id: uuids[0],
          value: 'key 0',
        },
        {
          id: uuids[2],
          value: 'key 2',
        },
        {
          id: uuids[4],
          value: 'key 4',
        },
      ])
    })

    it('should be able to query union indexes', async () => {
      const data = await db.entries({ where: { OR: ['mod2_0', 'mod3_0'] } })
      expect(data).toStrictEqual([
        {
          id: uuids[0],
          value: 'key 0',
        },
        {
          id: uuids[2],
          value: 'key 2',
        },
        {
          id: uuids[3],
          value: 'key 3',
        },
        {
          id: uuids[4],
          value: 'key 4',
        },
      ])
    })

    it('should be able to query intersection indexes', async () => {
      const data = await db.entries({ where: { AND: ['mod3_0', 'mod2_0'] } })
      expect(data).toStrictEqual([
        {
          id: uuids[0],
          value: 'key 0',
        },
      ])
    })

    it('should be able to query intersection and union indexes', async () => {
      const data = await db.entries({
        where: {
          AND: ['mod2_0'],
          OR: ['mod3_0', 'mod3_1'],
        },
      })
      expect(data).toStrictEqual([
        {
          id: uuids[0],
          value: 'key 0',
        },
        {
          id: uuids[4],
          value: 'key 4',
        },
      ])

      const data2 = await db.entries({
        where: {
          AND: ['mod2_0', 'mod2_1'],
          OR: ['mod3_0', 'mod3_1', 'mod3_2'],
        },
      })
      expect(data2).toStrictEqual([])
    })
  })
})
