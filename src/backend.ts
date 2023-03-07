import Redis from 'ioredis'
const DEFAULT_URL = process.env['REDIS_URL'] || 'redis://localhost:6379'

const defaultLogger = (err: unknown) => {
  console.error('Redbase backend error', err)
}

export function initRedis(url = DEFAULT_URL, errorLogger = defaultLogger) {
  const redis = new Redis(url, {
    enableAutoPipelining: true,
  })

  if (errorLogger) {
    redis.on('error', errorLogger)
  }

  return redis
}

export type ExecT = [error: Error | null, result: unknown][] | null
