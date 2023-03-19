export const defaultErrorHandler = (err: unknown): void | never => {
  // Screetching halt failure by default
  throw err
}

export type RawValue = string | number | Buffer
export type AggregationMode = 'SUM' | 'MIN' | 'MAX'
export type OrderingMode = 'ASC' | 'DESC'
export type Score = number | '-inf' | '+inf'

export interface RedisMultiAdapter {
  set(key: string, value: RawValue): RedisMultiAdapter
  expire(key: string, ttl: number): RedisMultiAdapter
  sadd(key: string, values: RawValue[]): RedisMultiAdapter
  zadd(key: string, scores: Score[], members: RawValue[]): RedisMultiAdapter
  exec(): Promise<void>
  del(keys: string[]): RedisMultiAdapter
  zrem(key: string, values: RawValue[]): RedisMultiAdapter
  zunionstore(
    destination: string,
    keys: string[],
    aggregate?: AggregationMode
  ): RedisMultiAdapter
  zinterstore(
    destination: string,
    keys: string[],
    aggregate?: AggregationMode
  ): RedisMultiAdapter
}

export interface RedisAdapter {
  multi(): RedisMultiAdapter
  quit(): Promise<void>
  ttl(key: string): Promise<number>
  smembers(key: string): Promise<string[]>
  zcount(key: string, min?: Score, max?: Score): Promise<number>
  zrange(
    key: string,
    start: number,
    stop: number,
    order?: OrderingMode
  ): Promise<string[]>
  get(key: string): Promise<string | null>
  del(keys: string[]): Promise<number>
}
