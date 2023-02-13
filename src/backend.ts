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
import { RedisClient } from 'ioredis/built/connectors/SentinelConnector/types'

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

  multi() {
    if (this.nodeRedis) {
      return this.nodeRedis.multi()
    }
    if (this.ioRedis) {
      return this.ioRedis.multi()
    }
    throw new Error('No redis client available')
  }

  zRange(
    key: string,
    min: string,
    max: string,
    opts: Parameters<RedisClientType['ZRANGE']>[3]
  ) {
    if (this.nodeRedis) {
      return this.nodeRedis.zRange(key, min, max, opts)
    }
    if (this.ioRedis) {
      const [key, min, max] = args.slice(0, 3)
      const optsObj = args[3]
      const opts =
        typeof optsObj === 'object' && !Buffer.isBuffer(optsObj)
          ? objectToArgs(optsObj)
          : []
      const newArgs = [key, min, max, ...opts]
      return this.ioRedis.zrange(...newArgs)
    }
    throw new Error('No redis client available')
  }
}

function objectToArgs(obj: ZRangeOptions | ZRangeByScoreOptions) {
  return Object.entries(obj).reduce((acc, [key, value]) => {
    acc.push(key)
    acc.push(value.toString())
    return acc
  }, [] as string[])
}

type ExecT =
  | [error: Error | null, result: unknown][]
  | null
  | RedisCommandRawReply

export { ExecT, ChainableCommander, RedisClientType }
