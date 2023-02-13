import { Redis as IORedis } from 'ioredis'
import { createClient } from 'redis'

const redisUrl = process.env['REDIS_URL'] || 'redis://localhost:6379'

const ioRedis = new IORedis(redisUrl, {
  enableAutoPipelining: true,
})

ioRedis.on('error', (err: any) => {
  throw err
})

const nodeRedis = createClient({
  url: redisUrl,
})

nodeRedis.on('error', (err: any) => {
  throw err
})

export { ioRedis, nodeRedis }
