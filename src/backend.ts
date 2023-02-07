import Redis from 'ioredis'
const redisUrl = process.env['REDIS_URL'] || 'redis://localhost:6379'

const redis = new Redis(redisUrl, {
  enableAutoPipelining: true,
})

redis.on('error', (err: any) => {
  console.error('Redis cache backend error', err)
})

type ExecT = [error: Error | null, result: unknown][] | null

export { redis, ExecT }
