import Redis, { ChainableCommander } from 'ioredis'
import { RedisAdapter, defaultLogger, RedisMultiAdapter } from './base'
const DEFAULT_URL = process.env['REDIS_URL'] || 'redis://localhost:6379'

export class IORedisMulti extends RedisMultiAdapter {
  multi: ChainableCommander

  constructor(redis: Redis) {
    super()
    this.multi = redis.multi()
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
      // Errors occurred during the exec, so throw
      throw res
    }
  }

  del(key: string) {
    this.multi = this.multi.del(key)
    return this
  }
}

export class IORedis extends RedisAdapter {
  redis: Redis

  constructor(url = DEFAULT_URL, errorLogger = defaultLogger) {
    super()
    this.redis = new Redis(url, {
      enableAutoPipelining: true,
    })

    if (errorLogger) {
      this.redis.on('error', errorLogger)
    }
  }

  multi() {
    return new IORedisMulti(this.redis)
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
