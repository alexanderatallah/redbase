export const defaultLogger = (err: unknown) => {
  console.error('Redbase backend error', err)
}

export type RawValueT = string | number | Buffer

export type AggregationMode = 'SUM' | 'MIN' | 'MAX'
export type OrderingMode = 'ASC' | 'DESC'
export abstract class RedisMultiAdapter {
  abstract set(key: string, value: RawValueT): RedisMultiAdapter
  abstract expire(key: string, ttl: number): RedisMultiAdapter
  abstract sadd(key: string, ...values: RawValueT[]): RedisMultiAdapter
  abstract zadd(key: string, ...scoreMembers: RawValueT[]): RedisMultiAdapter
  abstract exec(): Promise<void>
  abstract del(...keys: string[]): RedisMultiAdapter
  abstract zrem(key: string, ...values: RawValueT[]): RedisMultiAdapter
  abstract zunionstore(
    destination: string,
    aggregate: AggregationMode | undefined,
    ...keys: string[]
  ): RedisMultiAdapter
  abstract zinterstore(
    destination: string,
    aggregate: AggregationMode | undefined,
    ...keys: string[]
  ): RedisMultiAdapter
}

export abstract class RedisAdapter {
  abstract multi(): RedisMultiAdapter
  abstract quit(): Promise<void>
  abstract ttl(key: string): Promise<number>
  abstract smembers(key: string): Promise<string[]>
  abstract zcount(
    key: string,
    min: string | number,
    max: string | number
  ): Promise<number>
  abstract zrange(
    key: string,
    min: RawValueT,
    max: RawValueT,
    order: OrderingMode | undefined
  ): Promise<string[]>
  abstract get(key: string): Promise<string | null>
  abstract del(...keys: string[]): Promise<number>
}
