import { Redis as IORedis } from 'ioredis'

const ioRedis = new IORedis(redisUrl, {
  enableAutoPipelining: true,
})

ioRedis.on('error', (err: any) => {
  console.error('Redis cache backend error', err)
})

export { ioRedis }
