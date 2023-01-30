import { Database, redis } from '../src'
import crypto from 'crypto'

describe('Simple string database', () => {
  let db: Database<string, string>

  beforeAll(() => {
    db = new Database<string, string>('Test')
  })

  afterAll(() => {
    redis.disconnect()
  })

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

  describe('get/set', () => {
    afterAll(async () => {
      await db.clear()
    })

    it('should be able to set values', async () => {
      await db.set('foo', 'bar')
      expect(await db.get('foo')).toBe('bar')
    })

    it('should not get unknown values', async () => {
      expect(await db.get('baz')).toBe(undefined)
    })

    it('should be able to list values', async () => {
      await db.set('baz', 'qux')
      await db.set('max', 'power')

      const data = await db.index()
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
    })
  })
})
