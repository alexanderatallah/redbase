export const defaultLogger = (err: unknown) => {
  console.error('Redbase backend error', err)
}

export abstract class RedisMultiAdapter {
  abstract set(key: string, value: string): RedisMultiAdapter
  abstract expire(key: string, ttl: number): RedisMultiAdapter
  abstract sadd(key: string, value: string): RedisMultiAdapter
  abstract zadd(key: string, score: number, value: string): RedisMultiAdapter
  abstract exec(): Promise<void>
  abstract del(key: string): RedisMultiAdapter
}

export abstract class RedisAdapter {
  abstract multi(): RedisMultiAdapter
  abstract quit(): Promise<void>
  abstract ttl(key: string): Promise<number>
  abstract smembers(key: string): Promise<string[]>
}
