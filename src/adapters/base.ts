export const defaultLogger = (err: unknown) => {
  console.error('Redbase backend error', err)
}

export type RawValue = string | number | Buffer
export type AggregationMode = 'SUM' | 'MIN' | 'MAX'
export type OrderingMode = 'ASC' | 'DESC'
export type Score = number | '-inf' | '+inf'

export abstract class RedisMultiAdapter {
  abstract set(key: string, value: RawValue): RedisMultiAdapter
  abstract expire(key: string, ttl: number): RedisMultiAdapter
  abstract sadd(key: string, values: RawValue[]): RedisMultiAdapter
  abstract zadd(
    key: string,
    scores: Score[],
    members: RawValue[]
  ): RedisMultiAdapter
  abstract exec(): Promise<void>
  abstract del(keys: string[]): RedisMultiAdapter
  abstract zrem(key: string, values: RawValue[]): RedisMultiAdapter
  abstract zunionstore(
    destination: string,
    keys: string[],
    aggregate?: AggregationMode
  ): RedisMultiAdapter
  abstract zinterstore(
    destination: string,
    keys: string[],
    aggregate?: AggregationMode
  ): RedisMultiAdapter
}

export abstract class RedisAdapter {
  abstract multi(): RedisMultiAdapter
  abstract quit(): Promise<void>
  abstract ttl(key: string): Promise<number>
  abstract smembers(key: string): Promise<string[]>
  abstract zcount(key: string, min?: Score, max?: Score): Promise<number>
  abstract zrange(
    key: string,
    start: number,
    stop: number,
    order?: OrderingMode
  ): Promise<string[]>
  abstract get(key: string): Promise<string | null>
  abstract del(keys: string[]): Promise<number>
}
