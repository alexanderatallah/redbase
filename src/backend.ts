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

/** Clients/ClusterClients from either `ioredis` or `redis`. */
export function wrapRedisClient(client: NodeRedisClient | IORedisClient) {
  const isIORedis = isIORedisClient(client)
  return new Proxy(client, {
    get(target, prop) {
      const propAsMethod = prop as keyof typeof target
      const isIORedisMethod = isIORedis && propAsMethod in target
      if (typeof target[propAsMethod] === 'function') {
        return new Proxy(target[propAsMethod], {
          apply: (target, thisArg, argumentsList) => {
            try {
              return Reflect.apply(target, thisArg, argumentsList)
            } catch (error: Error) {
              if (error['name'] === 'TypeError') {
                return Reflect.apply(target, thisArg, argumentsList)
              }
              throw error
            }
          },
        })
      } else {
        return Reflect.get(target, prop)
      }
    },
  })
}

type ExecT = [error: Error | null, result: unknown][] | null

export { ExecT, IORedisChain as ChainableCommander }
