import type {
  createClient as createRedisClient,
  createCluster as createRedisCluster,
} from 'redis'
import type {
  Redis as IORedis,
  Cluster as IORedisCluster,
  ChainableCommander as IORedisChain,
} from 'ioredis'

export type NodeRedisClient =
  | ReturnType<typeof createRedisClient>
  | ReturnType<typeof createRedisCluster>
export type IORedisClient = IORedis | IORedisCluster
/** Clients/ClusterClients from either `ioredis` or `redis`. */

export class RedisOmniClient {
  constructor(
    public readonly client: NodeRedisClient | IORedisClient,
    public readonly isIORedis: boolean
  ) {}

  /** A typeguard for determining which client this is */
  private _isIORedisClient(
    client: NodeRedisClient | IORedisClient
  ): client is IORedisClient {
    return (
      'eval' in client &&
      'evalsha' in client &&
      'defineCommand' in client &&
      'createBuiltinCommand' in client
    )
  }

  // async quit() {
  //   if (this.isIORedis) {
  //     await (this.client as IORedisClient).quit()
  //   } else {
  //     await new Promise((resolve, reject) => {
  //       ;(this.client as NodeRedisClient).quit((err, res) => {
  //         if (err) {
  //           reject(err)
  //         } else {
  //           resolve(res)
  //         }
  //       })
  //     })
  //   }
  // }
}

const redisUrl = process.env['REDIS_URL'] || 'redis://localhost:6379'

const ioRedis = new IORedis(redisUrl, {
  enableAutoPipelining: true,
})

ioRedis.on('error', (err: any) => {
  console.error('Redis cache backend error', err)
})

type ExecT = [error: Error | null, result: unknown][] | null

export { ioRedis as redis, ExecT, IORedisChain as ChainableCommander }
