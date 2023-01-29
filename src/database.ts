

import { redis, type ExecT } from './backend'
import { ChainableCommander, RedisKey, RedisValue } from 'ioredis'
import crypto from 'crypto'
import { toUTCSeconds } from './utils'

export interface Entry<K, V> {
  id: string,
  key: K,
  value: V
}

export interface Tag {
  name: string,
  parent?: Tag
}

/**
  INDEX SCHEMA

  `key-cache:${CACHE_NAME}:${CONTENT_ID}`: this is where the entry is
      stored (as a string until we have json support)

  `key-cache:${CACHE_NAME}:${CONTENT_ID}/indices`: this is where the
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

const CLASS_KEY_PREFIX = "key-cache2"

type KeyT = RedisKey | Record<any, any>
type ValueT = RedisValue | Record<any, any>

class Database<K extends KeyT, V extends ValueT | ValueT[]> {
  public exp: number | undefined

  // Private, since changing this after initialization will break things
  private _name: string
  private _tagPathSeparator: string
  private _hashingAlgo: string

  constructor(name: string, defaultExpiration: number | undefined, tagPathSeparator: string = "/", hashingAlgo = 'sha1') {
    this.exp = defaultExpiration

    this._name = name
    this._tagPathSeparator = tagPathSeparator
    this._hashingAlgo = hashingAlgo
  }

  public get name() {
    return this._name;
  }

  getCID(obj: K): string {
    if (!(typeof obj === "object")) {
      return obj.toString()
    }
    if (obj instanceof Buffer) {
      return this._hash(obj.toString())
    }
    const keys = Object.keys(obj).sort()
    const values = keys.map(k => obj[k])
    return this._hash(JSON.stringify([keys, values]))
  }

  async get(entryKey: K): Promise<V | undefined> {
    // TODO use RedisJSON
    const cid = this.getCID(entryKey)
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

  async save(
    entryKey: K,
    value: V,
    tagNames?: string | string[],
    sortBy?: (val: V) => number
  ): Promise<ExecT> {

    if (!Array.isArray(tagNames)) {
      tagNames = [tagNames || ""]
    }
    const cid = this.getCID(entryKey)

    const entry: Entry<K, V> = {
      id: cid,
      key: entryKey,
      value: value
    }

    const score = sortBy ? sortBy(value) : toUTCSeconds(new Date())
    const tags = tagNames.map(p => this._getTagHierarchy(p))

    let txn = redis
      .multi()
      .set(this._entryKey(cid), JSON.stringify(entry))

    for (let tag of tags) {
      txn = txn.sadd(this._indicesForEntryKey(cid), tag.name)

      // Traverse child hierarchy
      while (tag.parent) {
        txn = txn.zadd(this._indexKey(tag), score, cid)
        txn = txn.zadd(this._childrenOfIndexKey(tag.parent), 0, tag.name)
        tag = tag.parent
      }
      // Note that there might be duplicate zadd calls for shared parents
      txn = txn.zadd(this._indexKey(tag), score, cid)
    }

    // Set expiration
    // TODO: set expiration on index keys
    if (this.exp) {
      txn = txn.expire(this._entryKey(cid), this.exp)
    }
    return txn.exec()
  }

  async delete(key: K): Promise<ExecT> {
    const cid = this.getCID(key)
    return this.deleteByID(cid)
  }

  async deleteByID(cid: string): Promise<ExecT> {
    console.log("DELETING ENTRY", cid)
    const indexKey = this._indicesForEntryKey(cid)
    console.log("DELETING INDEX SET", indexKey)
    const indexPaths = await redis.smembers(indexKey)
    const indices = indexPaths.map(p => this._getTagHierarchy(p))

    let txn = redis
      .multi()
      .del(this._entryKey(cid))
      .del(indexKey)

    for (let index of indices) {
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

  async deleteAll(indexPath: string | undefined): Promise<PromiseSettledResult<ExecT>[]> {
    console.log("DELETING ALL", indexPath)

    const index = this._getTagHierarchy(indexPath || "")
    const cids = await redis.zrange(this._indexKey(index), 0, -1)

    // Pipeline multple calls to delete above
    const deletions = cids.map(cid => this.deleteByID(cid))
    // Also delete the index itself and all children
    const indexMultiDeletion = this._recursiveIndexDeletion(redis.multi(), index).exec()

    return Promise.allSettled([...deletions, indexMultiDeletion])
  }

  async list(indexPath: string | undefined, offset: number = 0, limit: number = 20): Promise<Entry<K, V>[]> {
    const index = this._getTagHierarchy(indexPath || "")
    const hashes = await redis.zrange(this._indexKey(index), offset, offset + limit, 'REV')
    const values = await Promise.all(hashes.map(h => this._getByCID(h)))
    return values.map(v => v && JSON.parse(v)).filter(this._isValidEntry)
  }

  async subTags(rootTag: string | undefined, offset: number = 0, limit: number = 20): Promise<string[]> {
    const index = this._getTagHierarchy(rootTag || "")
    const redisKey = this._childrenOfIndexKey(index)
    return redis.zrange(redisKey, offset, offset + limit)
  }

  // Helpers

  _getByCID(cid: string): Promise<string | null> {
    return redis.get(this._entryKey(cid))
  }

  _entryKey(cid: string): string {
    return `${CLASS_KEY_PREFIX}:${this.name}:${cid}`
  }

  _indicesForEntryKey(cid: string): string {
    return `${this._entryKey(cid)}/indices`
  }

  _indexKey(tag: Tag): string {
    const suffix = tag.name ? `:${tag.name}` : ""
    return `${CLASS_KEY_PREFIX}:index:${this.name}${suffix}`
  }

  _childrenOfIndexKey(tag: Tag): string {
    return `${this._indexKey(tag)}:children`
  }

  _getTagHierarchy(tagName: string): Tag {
    // Input: "/a/b/c"
    // Output: ["", "/a", "/a/b", "/a/b/c"]
    // Invalid: "/", "/a/b/c/"
    if (tagName === "/" || tagName?.endsWith(this._tagPathSeparator)) {
      throw new Error("Path must not be or end with separator: " + tagName)
    }
    if (!tagName) {
      // Root node
      return { name: "" }
    }
    const parentName = tagName.split(this._tagPathSeparator).slice(0, -1).join(this._tagPathSeparator)
    return {
      name: tagName,
      parent: this._getTagHierarchy(parentName)
    }
  }

  _isValidEntry(x: object | null | undefined): x is Entry<K, V> {
    return !!x && ('key' in x) && ('value' in x) && ('id' in x)
  }

  _recursiveIndexDeletion(multi: ChainableCommander, tag: Tag): ChainableCommander {
    let ret = multi.del(this._indexKey(tag))
    const childIndices = redis.zrange(this._childrenOfIndexKey(tag), 0, -1)
    for (const child in childIndices) {
      ret = this._recursiveIndexDeletion(ret, this._getTagHierarchy(child))
    }
    return ret.del(this._childrenOfIndexKey(tag))
  }

  _hash(toHash: string): string {
    return crypto.createHash(this._hashingAlgo).update(toHash, 'utf8').digest('hex')
  }
}

export { Database, redis }
