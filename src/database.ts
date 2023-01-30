import { redis, ExecT } from './backend'
import { ChainableCommander, RedisKey, RedisValue } from 'ioredis'
import crypto from 'crypto'

export interface Entry<K, V> extends Record<string, unknown> {
  id: string
  key: K
  value: V
}

export interface Index {
  name: string
  parent?: Index
}

/**
  INDEX SCHEMA

  `key-cache:${CACHE_NAME}:${CONTENT_ID}`: this is where the entry is
      stored (as a string until we have json support)

  `key-cache:${CACHE_NAME}:${CONTENT_ID}/indexes`: this is where the
      list of tags is stored, as a set of strings, so we can delete
      the entry's index memberships later

  `key-cache:index:${CACHE_NAME}:{TAG_1}/{TAG_2}`: this is an example
      index, stored as a sorted set of content id strings, so we can
      list the entries later that fall under an optionally-nested tag.

      NOTE: `key-cache:index:${CACHE_NAME}` is the root index, with
      everything in it.
  
  `key-cache:index:${CACHE_NAME}:{TAG_1}/{TAG_2}:children`: this is
      a sorted set of the children on an index, so we can list them
      and delete them later
 */

const GLOBAL_PREFIX = process.env['REDIS_PREFIX'] || ''

type KeyT = RedisKey | Record<string, unknown>
type ValueT = RedisValue | Record<string, unknown>

export interface Options {
  defaultExpiration?: number // Default expiration (in seconds) to use for each entry. Defaults to undefined
  indexPathSeparator?: string // Separator for nested indexes. Defaults to "/"
  hashingAlgo?: string // Algorithm to use for hashing keys, defaults to sha1
}

class Database<K extends KeyT, V extends ValueT | ValueT[]> {
  public exp: number | undefined

  // Private, since changing this after initialization will break things
  private _name: string
  private _indexPathSeparator: string
  private _hashingAlgo: string

  constructor(name: string, opts: Options = {}) {
    this.exp = opts.defaultExpiration
    this._name = name
    this._indexPathSeparator = opts.indexPathSeparator || '/'
    this._hashingAlgo = opts.hashingAlgo || 'sha1'
  }

  public get name() {
    return this._name
  }

  async get(entryKey: K): Promise<V | undefined> {
    const cid = this.toCID(entryKey)
    const ret = await this._getByCID(cid)
    if (!ret) {
      return undefined
    }
    const parsed = JSON.parse(ret)
    if (!this._isValidEntry(parsed)) {
      return undefined
    }
    return parsed.value
  }

  async set(
    key: K,
    value: V,
    tagNames?: string | string[],
    sortBy?: (val: V) => number
  ): Promise<ExecT> {
    if (!Array.isArray(tagNames)) {
      tagNames = [tagNames || '']
    }
    const cid = this.toCID(key)

    const entry: Entry<K, V> = {
      id: cid,
      key: key,
      value: value,
    }

    const score = sortBy ? sortBy(value) : new Date().getTime()
    const tags = tagNames.map(p => this._getIndexHierarchy(p))

    let txn = redis.multi().set(this._entryKey(cid), JSON.stringify(entry))

    for (const tag of tags) {
      txn = this._updateIndex(txn, tag, cid, score)
    }

    // Set expiration
    // TODO: provide a way to clean up index keys
    if (this.exp) {
      txn = txn.expire(this._entryKey(cid), this.exp)
    }
    return txn.exec()
  }

  async del(key: K): Promise<ExecT> {
    const cid = this.toCID(key)
    return this._delByID(cid)
  }

  toCID(obj: K): string {
    if (!(typeof obj === 'object') || obj instanceof Buffer) {
      return this._hash(obj.toString())
    }
    const keys = Object.keys(obj).sort()
    const values = keys.map(k => obj[k])
    return this._hash(JSON.stringify([keys, values]))
  }

  async clear(indexPath?: string): Promise<PromiseSettledResult<ExecT>[]> {
    console.log('DELETING ' + (indexPath || 'ALL'))

    const index = this._getIndexHierarchy(indexPath || '')
    const cids = await redis.zrange(this._indexKey(index), 0, -1)

    // Pipeline multple calls to delete above
    const deletions = cids.map(cid => this._delByID(cid))
    // Also delete the index itself and all children
    const indexMultiDeletion = this._recursiveIndexDeletion(
      redis.multi(),
      index
    ).exec()

    return Promise.allSettled([...deletions, indexMultiDeletion])
  }

  async entries(
    indexPath?: string | undefined,
    offset = 0,
    limit = 20
  ): Promise<Entry<K, V>[]> {
    const index = this._getIndexHierarchy(indexPath || '')
    const hashes = await redis.zrange(
      this._indexKey(index),
      offset,
      offset + limit - 1, // ZRANGE limits are inclusive
      'REV'
    )
    const values = await Promise.all(hashes.map(h => this._getByCID(h)))
    return values
      .map(v => v && JSON.parse(v))
      .filter(o => this._isValidEntry(o))
  }

  async indexes(
    rootIndexName?: string | undefined,
    offset = 0,
    limit = 20
  ): Promise<string[]> {
    const index = this._getIndexHierarchy(rootIndexName || '')
    const redisKey = this._childrenOfIndexKey(index)
    return redis.zrange(redisKey, offset, offset + limit)
  }

  _updateIndex(
    txn: ChainableCommander,
    tag: Index,
    cid: string,
    score: number
  ) {
    txn = txn.sadd(this._indexesForEntryKey(cid), tag.name)

    // Traverse child hierarchy
    while (tag.parent) {
      txn = txn.zadd(this._indexKey(tag), score, cid)
      txn = txn.zadd(this._childrenOfIndexKey(tag.parent), 0, tag.name)
      tag = tag.parent
    }
    // Note that there might be harmless, duplicate zadd calls for shared parents
    txn = txn.zadd(this._indexKey(tag), score, cid)
    return txn
  }

  async _delByID(cid: string): Promise<ExecT> {
    const indexKey = this._indexesForEntryKey(cid)
    console.log(`DELETING ENTRY ${cid} AND INDEX KEY ${indexKey}`)
    const indexPaths = await redis.smembers(indexKey)
    const indexes = indexPaths.map(p => this._getIndexHierarchy(p))

    let txn = redis.multi().del(this._entryKey(cid)).del(indexKey)

    for (let index of indexes) {
      // Traverse child hierarchy
      while (index.parent) {
        txn = txn.zrem(this._indexKey(index), cid)
        index = index.parent
      }
      // Root. Note that there might be duplicate zrem calls for shared parents, esp root
      txn = txn.zrem(this._indexKey(index), cid)
    }
    return txn.exec()
  }

  // Helpers

  _getByCID(cid: string): Promise<string | null> {
    return redis.get(this._entryKey(cid))
  }

  _entryKey(cid: string): string {
    return `${GLOBAL_PREFIX}:${this.name}:${cid}`
  }

  _indexesForEntryKey(cid: string): string {
    return `${this._entryKey(cid)}/indexes`
  }

  _indexKey(index: Index): string {
    const suffix = index.name ? `:${index.name}` : ''
    return `${GLOBAL_PREFIX}:${this.name}:index${suffix}`
  }

  _childrenOfIndexKey(index: Index): string {
    return `${this._indexKey(index)}:children`
  }

  _getIndexHierarchy(indexName: string): Index {
    // Input: "/a/b/c"
    // Output: ["", "/a", "/a/b", "/a/b/c"]
    // Invalid: "/", "/a/b/c/"
    if (indexName === '/' || indexName?.endsWith(this._indexPathSeparator)) {
      throw new Error('Path must not be or end with separator: ' + indexName)
    }
    if (!indexName) {
      // Root node
      return { name: '' }
    }
    const parentName = indexName
      .split(this._indexPathSeparator)
      .slice(0, -1)
      .join(this._indexPathSeparator)
    return {
      name: indexName,
      parent: this._getIndexHierarchy(parentName),
    }
  }

  _isValidEntry(
    x: Record<string, unknown> | null | undefined
  ): x is Entry<K, V> {
    return !!x && 'key' in x && 'value' in x && 'id' in x
  }

  _recursiveIndexDeletion(
    multi: ChainableCommander,
    index: Index
  ): ChainableCommander {
    let ret = multi.del(this._indexKey(index))
    const childindexes = redis.zrange(this._childrenOfIndexKey(index), 0, -1)
    for (const child in childindexes) {
      ret = this._recursiveIndexDeletion(ret, this._getIndexHierarchy(child))
    }
    return ret.del(this._childrenOfIndexKey(index))
  }

  _hash(toHash: string): string {
    return crypto
      .createHash(this._hashingAlgo)
      .update(toHash, 'utf8')
      .digest('hex')
  }
}

export { Database, redis }
