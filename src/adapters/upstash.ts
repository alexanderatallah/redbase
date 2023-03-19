import {
  RedisAdapter,
  RedisMultiAdapter,
  AggregationMode,
  OrderingMode,
  Score,
  RawValue,
} from './base'

export type UpstashRequest = {
  path?: string[]
  body?: unknown
}

type UpstashResponse<TResult = unknown> =
  | {
      result: TResult
      error?: never
    }
  | {
      result?: never
      error: string
    }

/**
 * UpstashRest is a small wrapper around fetch and only meant for internal use
 */
class UpstashRest {
  private readonly url: string
  private readonly token

  constructor(opts: { url: string; token: string }) {
    this.url = opts.url
    this.token = opts.token
  }

  public async multi<TResult extends unknown[]>(
    command: unknown
  ): Promise<TResult> {
    return await this.fetch({ path: ['multi-exec'], body: command })
  }
  public async do<TResult>(...command: unknown[]): Promise<TResult> {
    return await this.fetch({ body: command })
  }

  private async fetch<TResult>(req: UpstashRequest): Promise<TResult> {
    const res = await fetch([this.url, ...(req.path ?? [])].join('/'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(req.body),
    })
    if (res.status >= 400) {
      throw new Error(await res.text())
    }
    const response = (await res.json()) as UpstashResponse<TResult>

    if (response.error) {
      throw new Error(`Error from Upstash: ${response.error}`)
    }
    // not sure why typescript doesn't detect this as non-nullable tbh
    // eslint-disable-next-line
    return response.result!
  }
}

export class UpstashMulti implements RedisMultiAdapter {
  private readonly commands: unknown[][]
  private readonly client: UpstashRest

  constructor(client: UpstashRest) {
    this.client = client
    this.commands = []
  }

  set(key: string, value: RawValue) {
    this.commands.push(['set', key, value])
    return this
  }

  expire(key: string, ttl: number) {
    this.commands.push(['expire', key, ttl])
    return this
  }

  sadd(key: string, values: RawValue[]) {
    this.commands.push(['sadd', key, ...values])
    return this
  }

  zadd(key: string, scores: Score[], members: RawValue[]) {
    const zipped = scores.flatMap((s, i) => [s, members[i]])
    this.commands.push(['zadd', key, ...zipped])
    return this
  }

  async exec() {
    await this.client.multi(this.commands)
    // TODO: error handling
  }

  del(keys: string[]) {
    this.commands.push(['del', ...keys])
    return this
  }

  zrem(key: string, values: RawValue[]) {
    this.commands.push(['zrem', key, ...values])
    return this
  }

  zunionstore(
    destination: string,
    keys: string[],
    aggregate?: AggregationMode
  ): RedisMultiAdapter {
    const aggSettings = aggregate ? ['AGGREGATE', aggregate] : []
    this.commands.push([
      'zunionstore',
      destination,
      keys.length,
      ...keys,
      ...aggSettings,
    ])
    return this
  }

  zinterstore(
    destination: string,
    keys: string[],
    aggregate?: AggregationMode
  ): RedisMultiAdapter {
    const aggSettings = aggregate ? ['AGGREGATE', aggregate] : []
    this.commands.push([
      'zinterstore',
      destination,
      keys.length,
      ...keys,
      ...aggSettings,
    ])
    return this
  }
}

export class Upstash implements RedisAdapter {
  private readonly client: UpstashRest
  constructor(opts: { url: string; token: string }) {
    this.client = new UpstashRest(opts)
  }

  multi() {
    return new UpstashMulti(this.client)
  }

  async quit() {
    // this is a noop for REST
  }

  async ttl(key: string) {
    return this.client.do<number>('ttl', key)
  }

  async get(key: string) {
    return this.client.do<string>('get', key)
  }

  async del(keys: string[]) {
    return this.client.do<number>('del', ...keys)
  }

  async smembers(key: string): Promise<string[]> {
    return this.client.do('smembers', key)
  }

  async zcount(
    key: string,
    min: Score = '-inf',
    max: Score = '+inf'
  ): Promise<number> {
    return this.client.do<number>('zcount', key, min, max)
  }

  async zrange(
    key: string,
    start: number,
    stop: number,
    order?: OrderingMode
  ): Promise<string[]> {
    if (order === 'DESC') {
      return this.client.do('zrange', key, start, stop, 'REV')
    } else {
      return this.client.do('zrange', key, start, stop)
    }
  }
}
