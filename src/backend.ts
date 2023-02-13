import type {
  createClient as createRedisClient,
  createCluster as createRedisCluster,
  RedisClientType,
} from 'redis'
import type { RedisCommandRawReply } from '@redis/client/dist/lib/commands'
import {
  Redis as IORedis,
  ChainableCommander,
  Cluster as IORedisCluster,
} from 'ioredis'
interface ZRangeOptions {
  REV?: true
  LIMIT?: {
    offset: number
    count: number
  }
}

export type NodeRedisClient =
  | ReturnType<typeof createRedisClient>
  | ReturnType<typeof createRedisCluster>
export type IORedisClient = IORedis | IORedisCluster

function isIORedisClient(
  client: NodeRedisClient | IORedisClient
): client is IORedisClient {
  return (
    'eval' in client &&
    'evalsha' in client &&
    'defineCommand' in client &&
    'createBuiltinCommand' in client
  )
}

export class RedisClientWrapper {
  public nodeRedis: NodeRedisClient | undefined
  public ioRedis: IORedisClient | undefined
  constructor(client: NodeRedisClient | IORedisClient) {
    if (isIORedisClient(client)) {
      this.ioRedis = client
    } else {
      this.nodeRedis = client
    }
  }

  set(key: string, value: string) {
    if (this.nodeRedis) {
      return this.nodeRedis.set(key, value)
    }
    if (this.ioRedis) {
      return this.ioRedis.set(key, value)
    }
    throw new Error('No redis client available')
  }

  get(key: string) {
    if (this.nodeRedis) {
      return this.nodeRedis.get(key)
    }
    if (this.ioRedis) {
      return this.ioRedis.get(key)
    }
    throw new Error('No redis client available')
  }

  ttl(key: string) {
    if (this.nodeRedis) {
      return this.nodeRedis.ttl(key)
    }
    if (this.ioRedis) {
      return this.ioRedis.ttl(key)
    }
    throw new Error('No redis client available')
  }

  multi() {
    if (this.nodeRedis) {
      // TODO: remove this type cast
      return this.nodeRedis.multi()
    }
    if (this.ioRedis) {
      return this.ioRedis.multi()
    }
    throw new Error('No redis client available')
  }

  zRange(
    key: string,
    min: number | '-inf',
    max: number | '+inf',
    opts?: ZRangeOptions
  ) {
    if (this.nodeRedis) {
      return this.nodeRedis.zRange(key, min, max, opts)
    }
    if (this.ioRedis) {
      const newArgs: Array<number | string> = [key, min, max]
      if (opts?.REV) {
        newArgs.push('REV')
      }
      if (opts?.LIMIT) {
        newArgs.push('LIMIT', opts.LIMIT.offset, opts.LIMIT.count)
      }
      // TODO incorporate Union types of parameter overloads when ready
      // https://github.com/microsoft/TypeScript/issues/32164
      return this.ioRedis.zrange(...(newArgs as [string, number, number]))
    }
    throw new Error('No redis client available')
  }

  sMembers(key: string) {
    if (this.nodeRedis) {
      return this.nodeRedis.sMembers(key)
    }
    if (this.ioRedis) {
      return this.ioRedis.smembers(key)
    }
    throw new Error('No redis client available')
  }

  zCount(key: string, min: number | '-inf', max: number | '+inf') {
    if (this.nodeRedis) {
      return this.nodeRedis.zCount(key, min, max)
    }
    if (this.ioRedis) {
      return this.ioRedis.zcount(key, min, max)
    }
    throw new Error('No redis client available')
  }
}

type ExecT =
  | [error: Error | null, result: unknown][]
  | null
  | RedisCommandRawReply

export { ExecT, ChainableCommander, RedisClientType }
