import { Database, redis } from '../src'
import { v4 as uuidv4 } from 'uuid'

describe('Database', () => {
  type ValueT = { answer: string; optional?: number[] }

  let db: Database<string>
  let dbComplex: Database<ValueT>

  beforeAll(() => {
    // Use a low ttl to prevent stale indices between tests
    db = new Database<string>('Test', { aggregateTagTTL: 0.1 })
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
      expect(() => (db.name = 'dest')).toThrowError()
    })
  })

  describe('simple get/save/delete/clear', () => {
    let fooId: string

    beforeEach(async () => {
      fooId = uuidv4()
      await db.save(fooId, 'foo')
      await dbComplex.save(fooId, { answer: 'foo' })
    })

    afterAll(async () => {
      await db.clear()
      await dbComplex.clear()
    })

    it('should be able to set values', async () => {
      const uuid = uuidv4()
      await db.save(uuid, 'bar')
      expect(await db.get(uuid)).toBe('bar')

      await dbComplex.save(uuid, { answer: 'bar', optional: [1, 2, 3] })
      expect(await dbComplex.get(uuid)).toEqual({
        answer: 'bar',
        optional: [1, 2, 3],
      })
    })

    it('should not get unknown values', async () => {
      expect(await db.get(uuidv4())).toBe(undefined)
      expect(await dbComplex.get(uuidv4())).toBe(undefined)
    })

    it('should be able to delete entries', async () => {
      await db.delete(fooId)
      expect(await db.get(fooId)).toBe(undefined)

      await dbComplex.delete(fooId)
      expect(await dbComplex.get(fooId)).toBe(undefined)
    })

    it('should be able to clear the database', async () => {
      const uuid = uuidv4()
      await db.save(uuid, 'bar')
      await db.clear()
      expect(await db.get(fooId)).toBe(undefined)
      expect(await db.get(uuid)).toBe(undefined)

      await dbComplex.clear()
      expect(await dbComplex.get(fooId)).toBe(undefined)
    })
  })

  describe('expire entries', () => {
    afterAll(async () => {
      await db.clear()
    })

    it('should not set expiring values < 1', () => {
      const uuid = uuidv4()
      expect(async () => await db.save(uuid, 'expiring', { ttl: 0.01 })).rejects
      expect(() => (db.defaultTTL = 0.1)).toThrow()
    })

    it('should be able to set expiring values', async () => {
      const uuid = uuidv4()
      // expect(db.defaultTTL).toBe(undefined)
      // TODO try this too: db.defaultTTL = 0.001
      await db.save(uuid, 'expiring', { ttl: 1 })
      expect(await db.ttl(uuid)).toBeCloseTo(1)
      expect(await db.get(uuid)).toBe('expiring')
      await new Promise(resolve => setTimeout(resolve, 1000))
      expect(await db.get(uuid)).toBe(undefined)
    })

    it('should be able to set expiring values by default', async () => {
      const uuid = uuidv4()
      expect(db.defaultTTL).toBe(undefined)
      db.defaultTTL = 1
      await db.save(uuid, 'expiring')
      expect(await db.ttl(uuid)).toBeCloseTo(1)
      expect(await db.get(uuid)).toBe('expiring')
      await new Promise(resolve => setTimeout(resolve, 1000))
      expect(await db.get(uuid)).toBe(undefined)
    })
  })

  describe('list and count entries', () => {
    let uuids: string[]

    beforeAll(async () => {
      uuids = Array.from({ length: 4 }, () => uuidv4())
      await db.save(uuids[0], 'bar')
      // Wait 10ms prevent pipelining (causes issues with ordering)
      await new Promise(resolve => setTimeout(resolve, 10))
      await db.save(uuids[1], 'qux')
      await new Promise(resolve => setTimeout(resolve, 10))
      await db.save(uuids[2], 'power')
      await dbComplex.save(uuids[3], { answer: 'bar' })
    })

    afterAll(async () => {
      await db.clear()
      await dbComplex.clear()
    })

    it('should be able to list entries', async () => {
      const data = await db.filter()
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

      const complexData = await dbComplex.filter()
      expect(complexData).toEqual([
        {
          id: uuids[3],
          value: { answer: 'bar' },
        },
      ])
    })

    it('should be able to reverse entries', async () => {
      const data = await db.filter({ ordering: 'desc' })
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
      let data = await db.filter({ limit: 2 })
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

      data = await db.filter({ limit: 2, offset: 2 })
      expect(data).toEqual([
        {
          id: uuids[2],
          value: 'power',
        },
      ])
    })
  })

  describe('index hierarchical entries', () => {
    let uuids: string[]

    beforeAll(async () => {
      uuids = Array.from({ length: 4 }, () => uuidv4())
      await db.save(uuids[0], 'foo', { tags: ['foo', '1'] })
      await new Promise(resolve => setTimeout(resolve, 10))
      await db.save(uuids[1], 'bar', { tags: ['bar', '1'] })
      await new Promise(resolve => setTimeout(resolve, 10))
      await db.save(uuids[2], 'foobar', { tags: ['foo/bar', '2'] })
    })

    afterAll(async () => {
      await db.clear()
      await dbComplex.clear()
    })

    it('should be able to filter entries by tag', async () => {
      const data = await db.filter({ where: { AND: ['foo'] } })
      expect(data).toEqual([
        {
          id: uuids[0],
          value: 'foo',
        },
        {
          id: uuids[2],
          value: 'foobar',
        },
      ])

      const data2 = await db.filter({ where: { AND: ['bar'] } })
      expect(data2).toEqual([
        {
          id: uuids[1],
          value: 'bar',
        },
      ])
    })

    it('should be able to count entries by tag', async () => {
      const count = await db.count({ where: { AND: ['foo'] } })
      expect(count).toBe(2)

      const count2 = await db.count({ where: { AND: ['bar'] } })
      expect(count2).toBe(1)
    })

    it('should clear along an tag', async () => {
      await db.clear({ where: 'foo' })
      const data = await db.filter()
      expect(data).toEqual([
        {
          id: uuids[1],
          value: 'bar',
        },
      ])
    })

    it('should clear tags as well as entries', async () => {
      await db.clear({ where: 'foo' })
      await db.save(uuids[0], 'foo')
      const data = await db.filter({ where: { AND: ['foo'] } })
      expect(data).toEqual([])

      await db.clear()
      const data2 = await db.filter({ where: { AND: ['bar'] } })
      expect(data2).toEqual([])
    })
  })

  describe('filter entries', () => {
    let uuids: string[]

    beforeAll(async () => {
      uuids = Array.from({ length: 6 }).map(() => uuidv4())
      for (let i = 0; i < uuids.length; i++) {
        await db.save(uuids[i], `key ${i}`, {
          tags: [`mod3_${i % 3}`, `mod2_${i % 2}`],
        })
        // Wait 10ms prevent pipelining
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    })

    afterAll(async () => {
      await db.clear()
    })

    it('should be able to filter all entries', async () => {
      const data = await db.filter()
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

    it('should be able to filter by individual tags', async () => {
      const data = await db.filter({ where: { AND: ['mod3_0'] } })
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

      const data2 = await db.filter({ where: { AND: ['mod2_0'] } })
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

    it('should be able to query union tags', async () => {
      const data = await db.filter({ where: { OR: ['mod2_0', 'mod3_0'] } })
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

    it('should be able to count union tags', async () => {
      const count = await db.count({ where: { OR: ['mod2_0', 'mod3_0'] } })
      expect(count).toBe(4)
    })

    it('should be able to query intersection tags', async () => {
      const data = await db.filter({ where: { AND: ['mod3_0', 'mod2_0'] } })
      expect(data).toStrictEqual([
        {
          id: uuids[0],
          value: 'key 0',
        },
      ])
    })

    it('should be able to count intersection tags', async () => {
      const count = await db.count({ where: { AND: ['mod3_0', 'mod2_0'] } })
      expect(count).toBe(1)
    })

    it('should be able to query intersection and union tags', async () => {
      const data = await db.filter({
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

      const data2 = await db.filter({
        where: {
          AND: ['mod2_0', 'mod2_1'],
          OR: ['mod3_0', 'mod3_1', 'mod3_2'],
        },
      })
      expect(data2).toStrictEqual([])
    })

    it('should be able to count intersection and union tags', async () => {
      const count = await db.count({
        where: {
          AND: ['mod2_0'],
          OR: ['mod3_0', 'mod3_1'],
        },
      })
      expect(count).toEqual(2)

      const count2 = await db.count({
        where: {
          AND: ['mod2_0', 'mod2_1'],
          OR: ['mod3_0', 'mod3_1', 'mod3_2'],
        },
      })
      expect(count2).toEqual(0)
    })

    it('should throw on invalid queries', () => {
      const filter = db.filter({
        where: {
          OR: ['mod3_0'],
        },
      })
      expect(filter).rejects
    })
  })

  describe('tags() for filtering tags', () => {
    let uuids: string[]

    beforeAll(async () => {
      uuids = Array.from({ length: 6 }).map(() => uuidv4())
      for (let i = 0; i < uuids.length; i++) {
        await db.save(uuids[i], `key ${i}`, {
          tags: [`math/mod2_${i % 2}`, `even/${(i % 2 === 0).toString()}`],
        })
        // Wait 10ms prevent pipelining
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    })

    afterAll(async () => {
      await db.clear()
    })

    it('should be able to list all tags', async () => {
      let data = await db.tags()
      expect(data).toStrictEqual(['even', 'math'])

      data = await db.tags({ where: { OR: [] } })
      expect(data).toStrictEqual(['even', 'math'])
    })

    it('should be able to list all tags in reverse order', async () => {
      const data = await db.tags({ ordering: 'desc' })
      expect(data).toStrictEqual(['math', 'even'])
    })

    it('should be able to filter down hierarchical tags', async () => {
      const data = await db.tags({ where: { OR: ['even'] } })
      expect(data).toEqual(['even/false', 'even/true'])

      const data2 = await db.tags({ where: { OR: ['even/true'] } })
      expect(data2).toEqual([])

      const data3 = await db.tags({ where: { OR: ['math'] } })
      expect(data3).toEqual(['math/mod2_0', 'math/mod2_1'])
    })

    it('should be able to query union tags', async () => {
      const data = await db.tags({
        where: { OR: ['math', 'even'] },
      })
      expect(data).toEqual([
        'even/false',
        'even/true',
        'math/mod2_0',
        'math/mod2_1',
      ])
    })
  })
})
