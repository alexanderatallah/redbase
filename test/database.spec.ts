import { Database, redis } from '../src'
import crypto from 'crypto'

describe('Database', () => {
  type KeyT = { question: string; mode: number }
  type ValueT = { answer: string; optional?: number[] }

  let db: Database<string, string>
  let dbComplex: Database<KeyT, ValueT>

  beforeAll(() => {
    db = new Database<string, string>('Test')
    dbComplex = new Database<KeyT, ValueT>('TestComplex')
  })

  afterAll(async () => {
    await db.clear()
    await dbComplex.clear()
    redis.disconnect()
  })

  describe('static properties', () => {
    it('should have a name getter', () => {
      expect(db.name).toBe('Test')
    })

    it('shoudl not have a name setter', () => {
      // @ts-ignore
      expect(() => (db.name = 'Test')).toThrowError()
    })

    it('should default to sha1 hashes', () => {
      const toHash = 'test'
      const hashed = crypto
        .createHash('sha1')
        .update(toHash, 'utf8')
        .digest('hex')
      expect(db._hash('test')).toBe(hashed)
    })
  })

  describe('single get/set/delete', () => {
    afterAll(async () => {
      await db.clear()
      await dbComplex.clear()
    })

    it('should be able to set values', async () => {
      await db.set('foo', 'bar')
      expect(await db.get('foo')).toBe('bar')

      await dbComplex.set({ question: 'foo', mode: 1 }, { answer: 'bar' })
      expect(await dbComplex.get({ question: 'foo', mode: 1 })).toEqual({
        answer: 'bar',
      })
    })

    it('should not get unknown values', async () => {
      expect(await db.get('baz')).toBe(undefined)
      expect(await dbComplex.get({ question: 'baz', mode: 1 })).toBe(undefined)
    })

    it('should be able to delete entries', async () => {
      await db.del('foo')
      expect(await db.get('foo')).toBe(undefined)
    })
  })

  describe('query entries', () => {
    beforeAll(async () => {
      await db.set('foo', 'bar')
      await db.set('baz', 'qux')
      await db.set('max', 'power')
      await dbComplex.set({ question: 'foo', mode: 1 }, { answer: 'bar' })
    })
    afterAll(async () => {
      await db.clear()
      await dbComplex.clear()
    })

    it('should be able to list entries', async () => {
      const data = await db.entries()
      expect(data).toEqual([
        {
          id: '0706025b2bbcec1ed8d64822f4eccd96314938d0',
          key: 'max',
          value: 'power',
        },
        {
          id: 'bbe960a25ea311d21d40669e93df2003ba9b90a2',
          key: 'baz',
          value: 'qux',
        },
        {
          id: '0beec7b5ea3f0fdbc95d0dd47f3c5bc275da8a33',
          key: 'foo',
          value: 'bar',
        },
      ])

      const complexData = await dbComplex.entries()
      expect(complexData).toEqual([
        {
          id: 'f653664de1d9478efcfc8e59e2b49e931bf28db8',
          key: { question: 'foo', mode: 1 },
          value: { answer: 'bar' },
        },
      ])
    })

    it('should be able to paginate entries', async () => {
      let data = await db.entries(undefined, 0, 2)
      expect(data).toEqual([
        {
          id: '0706025b2bbcec1ed8d64822f4eccd96314938d0',
          key: 'max',
          value: 'power',
        },
        {
          id: 'bbe960a25ea311d21d40669e93df2003ba9b90a2',
          key: 'baz',
          value: 'qux',
        },
      ])

      data = await db.entries(undefined, 2, 2)
      expect(data).toEqual([
        {
          id: '0beec7b5ea3f0fdbc95d0dd47f3c5bc275da8a33',
          key: 'foo',
          value: 'bar',
        },
      ])
    })
  })
})
