import Redis from 'ioredis'
const DEFAULT_URL = process.env['REDIS_URL'] || 'redis://localhost:6379'

export function initRedis(url = DEFAULT_URL) {
  const redis = new Redis(url, {
    enableAutoPipelining: true,
  })

  redis.on('error', (err: any) => {
    console.error('Redbase backend error', err)
  })

  return redis
}

export type ExecT = [error: Error | null, result: unknown][] | null
