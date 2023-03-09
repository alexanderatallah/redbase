import Redis, { ChainableCommander } from 'ioredis'
import {
  RedisAdapter,
  defaultLogger,
  RedisMultiAdapter,
  RawValueT,
  AggregationMode,
  OrderingMode,
} from './base'
const DEFAULT_URL = process.env['REDIS_URL'] || 'redis://localhost:6379'

export class IORedisMulti extends RedisMultiAdapter {
  multi: ChainableCommander
  redis: IORedis

  constructor(ioRedis: IORedis) {
    super()
    this.redis = ioRedis
    this.multi = ioRedis.redis.multi()
  }

  set(key: string, value: RawValueT) {
    this.multi = this.multi.set(key, value)
    return this
  }

  expire(key: string, ttl: number) {
    this.multi = this.multi.expire(key, ttl)
    return this
  }

  sadd(key: string, values: RawValueT[]) {
    this.multi = this.multi.sadd(key, ...values)
    return this
  }

  zadd(key: string, scores: RawValueT[], members: RawValueT[]) {
    const zipped = scores.flatMap((s, i) => [s, members[i]])
    this.multi = this.multi.zadd(key, ...zipped)
    return this
  }

  async exec() {
    const res = await this.multi.exec()
    if (!res || res.map(r => r[0]).filter(e => !!e).length) {
      // Errors occurred during the exec, so record backend error
      this.redis.errorHandler(res)
    }
  }

  del(keys: string[]) {
    this.multi = this.multi.del(...keys)
    return this
  }

  zrem(key: string, values: RawValueT[]) {
    this.multi = this.multi.zrem(key, ...values)
    return this
  }

  zunionstore(
    destination: string,
    keys: string[],
    aggregate?: AggregationMode
  ): RedisMultiAdapter {
    const aggSettings = aggregate ? ['AGGREGATE', aggregate] : []
    this.multi = this.multi.zunionstore(
      destination,
      keys.length,
      ...keys,
      ...aggSettings
    )
    return this
  }

  zinterstore(
    destination: string,
    keys: string[],
    aggregate?: AggregationMode
  ): RedisMultiAdapter {
    const aggSettings = aggregate ? ['AGGREGATE', aggregate] : []
    this.multi = this.multi.zinterstore(
      destination,
      keys.length,
      ...keys,
      ...aggSettings
    )
    return this
  }
}

export class IORedis extends RedisAdapter {
  redis: Redis
  errorHandler: (err: unknown) => void

  constructor(url = DEFAULT_URL, errorHandler = defaultLogger) {
    super()
    this.redis = new Redis(url, {
      enableAutoPipelining: true,
    })

    this.errorHandler = errorHandler
    this.redis.on('error', errorHandler)
  }

  multi() {
    return new IORedisMulti(this)
  }

  async quit() {
    await this.redis.quit()
  }

  async ttl(key: string) {
    return this.redis.ttl(key)
  }

  async get(key: string) {
    return this.redis.get(key)
  }

  async del(keys: string[]) {
    return this.redis.del(...keys)
  }

  async smembers(key: string): Promise<string[]> {
    return this.redis.smembers(key)
  }

  async zcount(
    key: string,
    min: string | number,
    max: string | number
  ): Promise<number> {
    return this.redis.zcount(key, min, max)
  }

  async zrange(
    key: string,
    min: RawValueT,
    max: RawValueT,
    order?: OrderingMode
  ): Promise<string[]> {
    if (order === 'DESC') {
      return this.redis.zrange(key, min, max, 'REV')
    } else {
      return this.redis.zrange(key, min, max)
    }
  }
}
