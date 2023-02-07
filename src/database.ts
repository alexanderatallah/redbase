import { redis, ExecT } from './backend'
import { ChainableCommander } from 'ioredis'
import { Tag } from './tag'

const GLOBAL_PREFIX = process.env['REDIS_PREFIX'] || ''
const DEBUG = process.env['DEBUG'] === 'true'
const AGG_TAG_TTL_BUFFER = 0.1 // seconds
export interface Options {
  defaultExpiration?: number // Default expiration (in seconds) to use for each entry. Defaults to undefined
  aggregateTagTTL?: number // TTL for computed query tags. Defaults to 10 seconds
  deletionPageSize?: number // Number of entries to delete at a time when calling "clear". Defaults to 2000.
}

export type OrderDirection = 'asc' | 'desc'

export type WithID<ValueT> = {
  id: string
  value: ValueT
}

type EntriesQueryWhere = {
  AND?: string[]
  OR?: string[]
}

type TagsQueryWhere = Omit<EntriesQueryWhere, 'AND'>

interface EntryQueryParams {
  where?: EntriesQueryWhere | string
  limit?: number
  offset?: number
  ordering?: OrderDirection
}

interface TagQueryParams {
  where?: TagsQueryWhere | string
  limit?: number
  offset?: number
  ordering?: OrderDirection
}

interface CountParams {
  where?: EntriesQueryWhere | string
  scoreMin?: number | '-inf'
  scoreMax?: number | '+inf'
}

interface ClearParams {
  where?: EntriesQueryWhere | string
}

interface SaveParams<ValueT> {
  tags?: string | string[]
  sortBy?: (v: ValueT) => number
}

/**
  SCHEMA

  `${REDIS_PREFIX}:${CACHE_NAME}:${CONTENT_ID}`: this is where the entry is
      stored (as a string until we have json support)

  `${REDIS_PREFIX}:${CACHE_NAME}:${CONTENT_ID}/tags`: this is where the
      list of tags is stored, as a set of strings, so we can delete
      the entry's tag memberships later

  `${REDIS_PREFIX}:tag:${CACHE_NAME}:{TAG_1}/{TAG_2}`: this is an example
      tag, stored as a sorted set of content id strings, so we can
      list the entries later that fall under an optionally-nested tag.

      NOTE: `${REDIS_PREFIX}:tag:${CACHE_NAME}` is the root tag, with
      everything in it.
  
  `${REDIS_PREFIX}:tag:${CACHE_NAME}:{TAG_1}/{TAG_2}:children`: this is
      a sorted set of the children on an tag, so we can list them
      and delete them later
 */

class Database<ValueT> {
  public exp: number | undefined
  public aggregateTagTTL: number
  public deletionPageSize: number

  // Private, since changing this after initialization will break things
  private _name: string

  constructor(name: string, opts: Options = {}) {
    this.exp = opts.defaultExpiration
    this.deletionPageSize = opts.deletionPageSize || 2000
    this._name = name
    this.aggregateTagTTL = opts.aggregateTagTTL || 10 // seconds
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
    { tags, sortBy }: SaveParams<ValueT> = {}
  ): Promise<ExecT> {
    if (!Array.isArray(tags)) {
      tags = [tags || '']
    }

    const score = sortBy ? sortBy(value) : new Date().getTime()
    const tagInstances = tags.map(p => Tag.fromPath(p))

    let txn = redis.multi().set(this._entryKey(id), JSON.stringify(value))

    for (const tag of tagInstances) {
      txn = this._indexEntry(txn, tag, id, score)
    }

    // Set expiration
    // TODO: provide a way to clean up tag keys
    if (this.exp) {
      txn = txn.expire(this._entryKey(id), this.exp)
    }
    return txn.exec()
  }

  async clear({ where = '' }: ClearParams = {}): Promise<number> {
    const count = await this.count({ where })
    if (DEBUG) {
      console.log(`DELETING ${count}`)
    }

    for (let offset = 0; offset < count; offset += this.deletionPageSize) {
      const ids = await this._queryIds({
        where,
        offset,
        limit: this.deletionPageSize,
        ordering: 'asc',
      })
      await Promise.all(ids.map(id => this.delete(id)))
    }

    // Also delete the tag itself and all children, if there are no possible entries left
    // TODO add tests
    const tagPathsToDelete: string[] =
      typeof where === 'string'
        ? [where]
        : where.AND?.length && where.OR?.length
        ? [] // Possible entries left
        : !where.AND?.length
        ? where.OR || []
        : where.AND.length === 1
        ? where.AND
        : [] // Possible entries left

    let txn = redis.multi()
    for (const tagPath of tagPathsToDelete) {
      txn = this._recursiveTagDeletion(txn, Tag.fromPath(tagPath))
    }

    await txn.exec()
    return count
  }

  async filter({
    where = '',
    offset = 0,
    limit = 20,
    ordering = 'asc',
  }: EntryQueryParams = {}): Promise<WithID<ValueT>[]> {
    const ids = await this._queryIds({ where, offset, limit, ordering })
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

  async tags({
    where = '',
    offset = 0,
    limit = 20,
    ordering = 'asc',
  }: TagQueryParams = {}): Promise<string[]> {
    const computedTag =
      typeof where === 'string'
        ? Tag.fromPath(where)
        : await this._getOrCreateTagsQuery(where)
    const args: [string, number, number] = [
      this._tagChildrenKey(computedTag),
      offset,
      offset + limit - 1, // ZRANGE limits are inclusive
    ]
    if (ordering === 'desc') {
      args.push('REV')
    }
    return redis.zrange(...args)
  }

  async count({
    where = '',
    scoreMin = '-inf',
    scoreMax = '+inf',
  }: CountParams = {}): Promise<number> {
    const computedTag =
      typeof where === 'string'
        ? Tag.fromPath(where)
        : await this._getOrCreateEntriesQuery(where)
    return redis.zcount(this._tagKey(computedTag), scoreMin, scoreMax)
  }

  async delete(id: string): Promise<ExecT> {
    const tagKey = this._entryTagsKey(id)
    if (DEBUG) {
      console.log(
        `DELETING entry ${id}, the set of tags at ${tagKey}, and ${id} from those tags`
      )
    }
    const tagPaths = await redis.smembers(tagKey)
    const tags = tagPaths.map(p => Tag.fromPath(p))

    // TODO Using unlink instead of del here doesn't seem to improve perf much
    let txn = redis.multi()
    txn = txn.del(this._entryKey(id))

    for (let tag of tags) {
      // Traverse child hierarchy
      while (tag.parent) {
        txn = txn.zrem(this._tagKey(tag), id)
        tag = tag.parent
      }
      // Root. Note that there might be duplicate zrem calls for shared parents, esp root
      txn = txn.zrem(this._tagKey(tag), id)
    }

    txn = txn.del(tagKey)
    return txn.exec()
  }

  async _queryIds({
    where,
    offset,
    limit,
    ordering,
  }: Required<EntryQueryParams>): Promise<string[]> {
    const computedTag =
      typeof where === 'string'
        ? Tag.fromPath(where)
        : await this._getOrCreateEntriesQuery(where)
    const args: [string, number, number] = [
      this._tagKey(computedTag),
      offset,
      offset + limit - 1, // ZRANGE limits are inclusive
    ]
    if (ordering === 'desc') {
      args.push('REV')
    }
    return redis.zrange(...args)
  }

  _indexEntry(
    txn: ChainableCommander,
    tag: Tag,
    entryId: string,
    score: number
  ) {
    // Tag this tag under the entry
    txn = txn.sadd(this._entryTagsKey(entryId), tag.name)

    // Traverse child hierarchy
    while (tag.parent) {
      // Tag the entry under this tag
      txn = txn.zadd(this._tagKey(tag), score, entryId)
      // Register this tag under its parent
      txn = txn.zadd(this._tagChildrenKey(tag.parent), 0, tag.name)
      // Move up the hierarchy
      tag = tag.parent
    }
    // We're at the root tag now - add the entry to it as well
    txn = txn.zadd(this._tagKey(tag), score, entryId)
    return txn
  }

  // Helpers

  _getRawValue(id: string): Promise<string | null> {
    return redis.get(this._entryKey(id))
  }

  _entryKey(id: string): string {
    return `${GLOBAL_PREFIX}:${this.name}:${id}`
  }

  _entryTagsKey(id: string): string {
    return `${this._entryKey(id)}/tags`
  }

  _tagKey(tag: Tag): string {
    return `${GLOBAL_PREFIX}:${this.name}:${tag.key}`
  }

  _tagChildrenKey(tag: Tag): string {
    return `${this._tagKey(tag)}:children`
  }

  _isValue(x: ValueT | null | undefined): x is ValueT {
    return !!x
  }

  async _getOrCreateEntriesQuery(where: EntriesQueryWhere): Promise<Tag> {
    const allTagPaths = (where.AND || []).concat(where.OR || [])
    if (allTagPaths.length === 0) {
      // No tags specified, so we'll use the root tag
      return Tag.root()
    }
    if (allTagPaths.length === 1) {
      // Only one tag specified, so we'll use that
      return Tag.fromPath(allTagPaths[0])
    }

    // Starting with where.OR, create a union tag
    let union: Tag | undefined, intersection: Tag | undefined

    if (where.OR?.length) {
      if (where.OR.length === 1) {
        throw new Error("Can't have a single tag in an OR query")
      }
      union = await this._getOrCreateTag(where.OR, 'union')
    }

    if (where.AND?.length) {
      if (where.AND.length === 1) {
        intersection = Tag.fromPath(where.AND[0])
      } else {
        intersection = await this._getOrCreateTag(where.AND, 'intersection')
      }
    }

    if (union && intersection) {
      return await this._getOrCreateTag(
        [union.name, intersection.name],
        'intersection'
      )
    } else {
      // Tag.root is unreachable, but here to evade a typescript bug
      return union || intersection || Tag.root()
    }
  }

  async _getOrCreateTagsQuery(where: TagsQueryWhere): Promise<Tag> {
    if (!where.OR || where.OR.length === 0) {
      // No tags specified, so we'll use the root tag
      return Tag.root()
    }
    if (where.OR.length === 1) {
      // Only one tag specified, so we'll use that
      return Tag.fromPath(where.OR[0])
    }

    const targetTag = Tag.fromPath(where.OR.join('+'))
    const txn = await this._getOrCreateAggregateTag(
      this._tagChildrenKey(targetTag),
      where.OR.map(n => this._tagChildrenKey(Tag.fromPath(n))),
      'union'
    )
    await txn.exec()
    return targetTag
  }

  async _getOrCreateTag(
    tagPaths: string[],
    type: 'union' | 'intersection'
  ): Promise<Tag> {
    const targetTag = Tag.fromPath(tagPaths.join(type === 'union' ? '+' : '&'))
    const txn = await this._getOrCreateAggregateTag(
      this._tagKey(targetTag),
      tagPaths.map(n => this._tagKey(Tag.fromPath(n))),
      type
    )
    await txn.exec()
    return targetTag
  }

  async _getOrCreateAggregateTag(
    targetTagKey: string,
    tagKeys: string[],
    type: 'union' | 'intersection'
  ): Promise<ChainableCommander> {
    let txn = redis.multi()
    if ((await redis.ttl(targetTagKey)) > AGG_TAG_TTL_BUFFER) {
      return txn
    }
    const methodName = type === 'union' ? 'zunionstore' : 'zinterstore'
    txn = txn[methodName](
      targetTagKey,
      tagKeys.length,
      ...tagKeys,
      'AGGREGATE',
      'MIN'
    ).expire(targetTagKey, this.aggregateTagTTL)
    return txn
  }

  _recursiveTagDeletion(
    multi: ChainableCommander,
    tag: Tag
  ): ChainableCommander {
    let ret = multi.del(this._tagKey(tag))
    const childtags = redis.zrange(this._tagChildrenKey(tag), 0, -1)
    for (const child in childtags) {
      ret = this._recursiveTagDeletion(ret, Tag.fromPath(child))
    }
    return ret.del(this._tagChildrenKey(tag))
  }
}

export { Database, redis }
