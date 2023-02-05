import { redis, ExecT } from './backend'
import { ChainableCommander } from 'ioredis'

const GLOBAL_PREFIX = process.env['REDIS_PREFIX'] || ''
const DEBUG = process.env['DEBUG'] === 'true'
const QUERY_INDEX_TTL_BUFFER = 0.1 // seconds
export interface Options {
  defaultExpiration?: number // Default expiration (in seconds) to use for each entry. Defaults to undefined
  indexPathSeparator?: string // Separator for nested indexes. Defaults to "/"
  indexUnionSeparator?: string // Separator for union indexes. Defaults to "|"
  queryIndexTTL?: number // TTL for computed query indexes. Defaults to 10 seconds
}

export type OrderDirection = 'asc' | 'desc'

export type Index = {
  name: string
  parent?: Index
}

export type WithID<ValueT> = {
  id: string
  value: ValueT
}

type EntriesQueryWhere = {
  AND?: string[]
  OR?: string[]
}

type IndexesQueryWhere = Omit<EntriesQueryWhere, 'AND'>

interface EntryQueryParams {
  where?: EntriesQueryWhere
  limit?: number
  offset?: number
  ordering?: OrderDirection
}

interface IndexQueryParams {
  where?: IndexesQueryWhere
  limit?: number
  offset?: number
  ordering?: OrderDirection
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
  public queryIndexTTL: number

  // Private, since changing this after initialization will break things
  private _name: string
  private _indexPathSeparator: string
  private _indexUnionSeparator: string

  constructor(name: string, opts: Options = {}) {
    this.exp = opts.defaultExpiration
    this._name = name
    this._indexPathSeparator = opts.indexPathSeparator || '/'
    this._indexUnionSeparator = opts.indexUnionSeparator || '|'
    this.queryIndexTTL = opts.queryIndexTTL || 10 // seconds
  }

  public get name() {
    return this._name
  }

  async get(id: string): Promise<ValueT | undefined> {
    const ret = await this._getRawValue(id)
    if (!ret) {
      return undefined
    }
    const parsed = JSON.parse(ret)
    if (!this._isValue(parsed)) {
      return undefined
    }
    return parsed
  }

  async save(
    id: string,
    value: ValueT,
    indexNames?: string | string[],
    sortBy?: (val: ValueT) => number
  ): Promise<ExecT> {
    if (!Array.isArray(indexNames)) {
      indexNames = [indexNames || '']
    }

    const score = sortBy ? sortBy(value) : new Date().getTime()
    const indexes = indexNames.map(p => this._nameToIndex(p))

    let txn = redis.multi().set(this._entryKey(id), JSON.stringify(value))

    for (const index of indexes) {
      txn = this._indexEntry(txn, index, id, score)
    }

    // Set expiration
    // TODO: provide a way to clean up index keys
    if (this.exp) {
      txn = txn.expire(this._entryKey(id), this.exp)
    }
    return txn.exec()
  }

  async clear(indexPath?: string): Promise<ExecT[]> {
    if (DEBUG) {
      console.log('DELETING ' + (indexPath || 'ALL'))
    }

    const index = this._nameToIndex(indexPath || '')
    const ids = await redis.zrange(this._indexKey(index), 0, -1)

    // Pipeline multple calls to delete above
    const deletions = ids.map(id => this.delete(id))
    // Also delete the index itself and all children
    const indexMultiDeletion = this._recursiveIndexDeletion(
      redis.multi(),
      index
    ).exec()

    return Promise.all([...deletions, indexMultiDeletion])
  }

  async filter({
    where = {},
    offset = 0,
    limit = 20,
    ordering = 'asc',
  }: EntryQueryParams = {}): Promise<WithID<ValueT>[]> {
    const computedIndex = await this._getOrCreateEntriesQuery(where)
    const args: [string, number, number] = [
      this._indexKey(computedIndex),
      offset,
      offset + limit - 1, // ZRANGE limits are inclusive
    ]
    if (ordering === 'desc') {
      args.push('REV')
    }
    const ids = await redis.zrange(...args)
    const values = await Promise.all(ids.map(h => this._getRawValue(h)))
    return values
      .map((o, i) => {
        const maybeVal = o ? JSON.parse(o) : undefined
        return this._isValue(maybeVal)
          ? { id: ids[i], value: maybeVal }
          : undefined
      })
      .filter((maybeVal): maybeVal is WithID<ValueT> => !!maybeVal)
  }

  async indexes({
    where = {},
    offset = 0,
    limit = 20,
    ordering = 'asc',
  }: IndexQueryParams = {}): Promise<string[]> {
    // const index = this._nameToIndex(rootIndexName || '')
    // return redis.zrange(this._indexChildrenKey(index), offset, offset + limit)
    const computedIndex = await this._getOrCreateIndexesQuery(where)
    const args: [string, number, number] = [
      this._indexChildrenKey(computedIndex),
      offset,
      offset + limit - 1, // ZRANGE limits are inclusive
    ]
    if (ordering === 'desc') {
      args.push('REV')
    }
    return redis.zrange(...args)
  }

  async count(
    indexPath?: string | undefined,
    min: number | '-inf' = '-inf',
    max: number | '+inf' = '+inf'
  ): Promise<number> {
    const index = this._nameToIndex(indexPath || '')
    return redis.zcount(this._indexKey(index), min, max)
  }

  async delete(id: string): Promise<ExecT> {
    const indexKey = this._entryIndexesKey(id)
    if (DEBUG) {
      console.log(
        `DELETING entry ${id}, the set of indexes at ${indexKey}, and ${id} from those indexes`
      )
    }
    const indexPaths = await redis.smembers(indexKey)
    const indexes = indexPaths.map(p => this._nameToIndex(p))

    // TODO Using unlink instead of del here doesn't seem to improve perf much
    let txn = redis.multi().unlink(this._entryKey(id)).unlink(indexKey)

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

  _indexEntry(
    txn: ChainableCommander,
    index: Index,
    entryId: string,
    score: number
  ) {
    // Register this index under the entry
    txn = txn.sadd(this._entryIndexesKey(entryId), index.name)

    // Traverse child hierarchy
    while (index.parent) {
      // Add the entry to this index
      txn = txn.zadd(this._indexKey(index), score, entryId)
      // Register this index under its parent
      txn = txn.zadd(this._indexChildrenKey(index.parent), 0, index.name)
      // Move up the hierarchy
      index = index.parent
    }
    // We're at the root index now - add the entry to it as well
    txn = txn.zadd(this._indexKey(index), score, entryId)
    return txn
  }

  // Helpers

  _getRawValue(id: string): Promise<string | null> {
    return redis.get(this._entryKey(id))
  }

  _entryKey(id: string): string {
    return `${GLOBAL_PREFIX}:${this.name}:${id}`
  }

  _entryIndexesKey(id: string): string {
    return `${this._entryKey(id)}/indexes`
  }

  _indexKey(index: Index): string {
    const suffix = index.name ? `:${index.name}` : ''
    return `${GLOBAL_PREFIX}:${this.name}:index${suffix}`
  }

  _indexChildrenKey(index: Index): string {
    return `${this._indexKey(index)}:children`
  }

  _nameToIndex(indexName: string): Index {
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
      parent: this._nameToIndex(parentName),
    }
  }

  _isValue(x: ValueT | null | undefined): x is ValueT {
    return !!x
  }

  async _getOrCreateEntriesQuery(where: EntriesQueryWhere): Promise<Index> {
    const allIndexNames = (where.AND || []).concat(where.OR || [])
    if (allIndexNames.length === 0) {
      // No indexes specified, so we'll use the root index
      return this._nameToIndex('')
    }
    if (allIndexNames.length === 1) {
      // Only one index specified, so we'll use that
      return this._nameToIndex(allIndexNames[0])
    }

    // Starting with where.OR, create a union index
    let union: Index | undefined, intersection: Index | undefined

    if (where.OR?.length) {
      if (where.OR.length === 1) {
        throw new Error("Can't have a single index in an OR query")
      }
      union = await this._getOrCreateIndex(where.OR, 'union')
    }

    if (where.AND?.length) {
      if (where.AND.length === 1) {
        intersection = this._nameToIndex(where.AND[0])
      } else {
        intersection = await this._getOrCreateIndex(where.AND, 'intersection')
      }
    }

    if (union && intersection) {
      return await this._getOrCreateIndex(
        [union.name, intersection.name],
        'intersection'
      )
    } else {
      // nameToIndex is unreachable, but here to evade a typescript bug
      return union || intersection || this._nameToIndex('')
    }
  }

  async _getOrCreateIndexesQuery(where: IndexesQueryWhere): Promise<Index> {
    if (!where.OR || where.OR.length === 0) {
      // No indexes specified, so we'll use the root index
      return this._nameToIndex('')
    }
    if (where.OR.length === 1) {
      // Only one index specified, so we'll use that
      return this._nameToIndex(where.OR[0])
    }

    const targetIndex = this._nameToIndex(where.OR.join('+'))
    const txn = await this._createAggregateIndex(
      this._indexChildrenKey(targetIndex),
      where.OR.map(n => this._indexChildrenKey(this._nameToIndex(n))),
      'union'
    )
    await txn.exec()
    return targetIndex
  }

  async _getOrCreateIndex(
    indexNames: string[],
    type: 'union' | 'intersection'
  ): Promise<Index> {
    const targetIndex = this._nameToIndex(
      indexNames.join(type === 'union' ? '+' : '&')
    )
    const txn = await this._createAggregateIndex(
      this._indexKey(targetIndex),
      indexNames.map(n => this._indexKey(this._nameToIndex(n))),
      type
    )
    await txn.exec()
    return targetIndex
  }

  async _createAggregateIndex(
    targetIndexKey: string,
    indexKeys: string[],
    type: 'union' | 'intersection'
  ): Promise<ChainableCommander> {
    let txn = redis.multi()
    if ((await redis.ttl(targetIndexKey)) > QUERY_INDEX_TTL_BUFFER) {
      return txn
    }
    const methodName = type === 'union' ? 'zunionstore' : 'zinterstore'
    txn = txn[methodName](
      targetIndexKey,
      indexKeys.length,
      ...indexKeys,
      'AGGREGATE',
      'MIN'
    ).expire(targetIndexKey, this.queryIndexTTL)
    return txn
  }

  _recursiveIndexDeletion(
    multi: ChainableCommander,
    index: Index
  ): ChainableCommander {
    let ret = multi.del(this._indexKey(index))
    const childindexes = redis.zrange(this._indexChildrenKey(index), 0, -1)
    for (const child in childindexes) {
      ret = this._recursiveIndexDeletion(ret, this._nameToIndex(child))
    }
    return ret.del(this._indexChildrenKey(index))
  }
}

export { Database, redis }
