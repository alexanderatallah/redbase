import { redis, ExecT } from './backend'
import { ChainableCommander } from 'ioredis'

const GLOBAL_PREFIX = process.env['REDIS_PREFIX'] || ''
const DEBUG = process.env['DEBUG'] === 'true'
export interface Options {
  defaultExpiration?: number // Default expiration (in seconds) to use for each entry. Defaults to undefined
  indexPathSeparator?: string // Separator for nested indexes. Defaults to "/"
}

export type OrderDirection = 'asc' | 'desc'

export type Entry<ValueT> = {
  id: string
  value: ValueT
}

export type Index = {
  name: string
  parent?: Index
}

/**
  INDEX SCHEMA

  `${REDIS_PREFIX}:${CACHE_NAME}:${CONTENT_ID}`: this is where the entry is
      stored (as a string until we have json support)

  `${REDIS_PREFIX}:${CACHE_NAME}:${CONTENT_ID}/indexes`: this is where the
      list of tags is stored, as a set of strings, so we can delete
      the entry's index memberships later

  `${REDIS_PREFIX}:index:${CACHE_NAME}:{TAG_1}/{TAG_2}`: this is an example
      index, stored as a sorted set of content id strings, so we can
      list the entries later that fall under an optionally-nested tag.

      NOTE: `${REDIS_PREFIX}:index:${CACHE_NAME}` is the root index, with
      everything in it.
  
  `${REDIS_PREFIX}:index:${CACHE_NAME}:{TAG_1}/{TAG_2}:children`: this is
      a sorted set of the children on an index, so we can list them
      and delete them later
 */

class Database<ValueT> {
  public exp: number | undefined

  // Private, since changing this after initialization will break things
  private _name: string
  private _indexPathSeparator: string

  constructor(name: string, opts: Options = {}) {
    this.exp = opts.defaultExpiration
    this._name = name
    this._indexPathSeparator = opts.indexPathSeparator || '/'
  }

  public get name() {
    return this._name
  }

  async get(id: string): Promise<ValueT | undefined> {
    const ret = await this._getRawEntry(id)
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
    id: string,
    value: ValueT,
    indexNames?: string | string[],
    sortBy?: (val: ValueT) => number
  ): Promise<ExecT> {
    if (!Array.isArray(indexNames)) {
      indexNames = [indexNames || '']
    }
    const entry: Entry<ValueT> = {
      id: id,
      value: value,
    }

    const score = sortBy ? sortBy(value) : new Date().getTime()
    const tags = indexNames.map(p => this._getIndexHierarchy(p))

    let txn = redis.multi().set(this._entryKey(id), JSON.stringify(entry))

    for (const tag of tags) {
      txn = this._updateIndex(txn, tag, id, score)
    }

    // Set expiration
    // TODO: provide a way to clean up index keys
    if (this.exp) {
      txn = txn.expire(this._entryKey(id), this.exp)
    }
    return txn.exec()
  }

  async clear(indexPath?: string): Promise<PromiseSettledResult<ExecT>[]> {
    if (DEBUG) {
      console.log('DELETING ' + (indexPath || 'ALL'))
    }

    const index = this._getIndexHierarchy(indexPath || '')
    const ids = await redis.zrange(this._indexKey(index), 0, -1)

    // Pipeline multple calls to delete above
    const deletions = ids.map(id => this.del(id))
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
    limit = 20,
    ordering: OrderDirection = 'asc'
  ): Promise<Entry<ValueT>[]> {
    const index = this._getIndexHierarchy(indexPath || '')
    const args: [string, number, number] = [
      this._indexKey(index),
      offset,
      offset + limit - 1, // ZRANGE limits are inclusive
    ]
    if (ordering === 'desc') {
      args.push('REV')
    }
    const ids = await redis.zrange(...args)
    const values = await Promise.all(ids.map(h => this._getRawEntry(h)))
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

  async del(id: string): Promise<ExecT> {
    const indexKey = this._indexesForEntryKey(id)
    if (DEBUG) {
      console.log(`DELETING ENTRY ${id} AND INDEX KEY ${indexKey}`)
    }
    const indexPaths = await redis.smembers(indexKey)
    const indexes = indexPaths.map(p => this._getIndexHierarchy(p))

    let txn = redis.multi().del(this._entryKey(id)).del(indexKey)

    for (let index of indexes) {
      // Traverse child hierarchy
      while (index.parent) {
        txn = txn.zrem(this._indexKey(index), id)
        index = index.parent
      }
      // Root. Note that there might be duplicate zrem calls for shared parents, esp root
      txn = txn.zrem(this._indexKey(index), id)
    }
    return txn.exec()
  }

  _updateIndex(txn: ChainableCommander, tag: Index, id: string, score: number) {
    txn = txn.sadd(this._indexesForEntryKey(id), tag.name)

    // Traverse child hierarchy
    while (tag.parent) {
      txn = txn.zadd(this._indexKey(tag), score, id)
      txn = txn.zadd(this._childrenOfIndexKey(tag.parent), 0, tag.name)
      tag = tag.parent
    }
    // Note that there might be harmless, duplicate zadd calls for shared parents
    txn = txn.zadd(this._indexKey(tag), score, id)
    return txn
  }

  // Helpers

  _getRawEntry(id: string): Promise<string | null> {
    return redis.get(this._entryKey(id))
  }

  _entryKey(id: string): string {
    return `${GLOBAL_PREFIX}:${this.name}:${id}`
  }

  _indexesForEntryKey(id: string): string {
    return `${this._entryKey(id)}/indexes`
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
    x: Record<keyof Entry<unknown>, unknown> | null | undefined
  ): x is Entry<ValueT> {
    return !!x && 'value' in x && 'id' in x
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
}

export { Database, redis }
