import Redis, { ChainableCommander } from 'ioredis'
import { RedisAdapter, defaultLogger, RedisMultiAdapter } from './base'
const DEFAULT_URL = process.env['REDIS_URL'] || 'redis://localhost:6379'

export class IORedisMulti extends RedisMultiAdapter {
  multi: ChainableCommander
  redis: IORedis

  constructor(ioRedis: IORedis) {
    super()
    this.redis = ioRedis
    this.multi = ioRedis.redis.multi()
  }

  set(key: string, value: string) {
    this.multi = this.multi.set(key, value)
    return this
  }

  expire(key: string, ttl: number) {
    this.multi = this.multi.expire(key, ttl)
    return this
  }

  sadd(key: string, value: string) {
    this.multi = this.multi.sadd(key, value)
    return this
  }

  zadd(key: string, score: number, value: string) {
    this.multi = this.multi.zadd(key, score, value)
    return this
  }

  async exec() {
    const res = await this.multi.exec()
    if (!res || res.map(r => r[0]).filter(e => !!e).length) {
      // Errors occurred during the exec, so record backend error
      this.redis.errorHandler(res)
    }
  }

  del(key: string) {
    this.multi = this.multi.del(key)
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

    if (errorHandler) {
      this.errorHandler = errorHandler
      this.redis.on('error', errorHandler)
    }
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

  async del(key: string) {
    return this.redis.del(key)
  }

  async smembers(key: string): Promise<string[]> {
    return this.redis.smembers(key)
  }
}
