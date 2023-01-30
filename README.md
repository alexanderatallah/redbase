# Redis database

A simple, fast, type-safe database on top of Redis.

### Features

- Hierarchical indexes (useful for tagging cached data)
- Small: only \_\_\_ lines
- Zero npm dependencies (works with `redis`, `node-redis` and `ioredis`)
- Only core Redis - no dependencies on Redis modules (useful for deploying on platforms like Upstash).

### Use cases

Can work as a type-safe cache that you need to be able to browse for discrepancies or query in a light-weight way. Some examples:

1. Cache prompts and completions from large language models to avoid paying for duplicate computation. Index them with hierarchical tags like `"user1/project1"` and then easily create an endpoint to browse both `user1`'s content across all projects and just their content for `project1`.

2. TODO!

[![npm package][npm-img]][npm-url]
[![Build Status][build-img]][build-url]
[![Downloads][downloads-img]][downloads-url]
[![Issues][issues-img]][issues-url]
[![Code Coverage][codecov-img]][codecov-url]
[![Commitizen Friendly][commitizen-img]][commitizen-url]
[![Semantic Release][semantic-release-img]][semantic-release-url]

## Install

```bash
npm install redis-database
```

## Usage

```ts
import { Database } from 'redis-database'

// Can use strings, numbers or buffers as well
type MyValue = {
  a: string
  b?: {
    c: string
  }
}

const db = new Database<MyValue>('myProject')

const key = uuid()
const value = { a: 'result' }

await db.get(key) // undefined

await db.set(key, value)

await db.get(key) // value

// Type safety!

await db.get('test2') // Type error on key
await db.set(key, { c: 'result2' }) // Type error on value

// Browsing results
let data = await db.entries()
assertDeepEquals(data, [{ id: key, value: { a: 'result' } }])

// Hierarchical indexes
await db.set(uuid(), { a: 'hi' }, ['user1/project1'])
await db.set(uuid(), { a: 'there' }, ['user1/project2'])
await db.set(uuid(), { a: 'bye' }, ['user2/project1'])

data = await db.index()
assertEquals(data.length, 3)

data = await db.index('user1')
assertEquals(data.length, 2)

// TODO data = await db.index("project1")
// assertEquals(data.length, ??)
```

## API

### myPackage(input, options?)

#### input

Type: `string`

Lorem ipsum.

#### options

Type: `object`

##### postfix

Type: `string`
Default: `rainbows`

Lorem ipsum.

[build-img]: https://github.com/alexanderatallah/typescript-npm-package-template/actions/workflows/release.yml/badge.svg
[build-url]: https://github.com/alexanderatallah/typescript-npm-package-template/actions/workflows/release.yml
[downloads-img]: https://img.shields.io/npm/dt/typescript-npm-package-template
[downloads-url]: https://www.npmtrends.com/typescript-npm-package-template
[npm-img]: https://img.shields.io/npm/v/typescript-npm-package-template
[npm-url]: https://www.npmjs.com/package/typescript-npm-package-template
[issues-img]: https://img.shields.io/github/issues/alexanderatallah/typescript-npm-package-template
[issues-url]: https://github.com/alexanderatallah/typescript-npm-package-template/issues
[codecov-img]: https://codecov.io/gh/alexanderatallah/typescript-npm-package-template/branch/main/graph/badge.svg
[codecov-url]: https://codecov.io/gh/alexanderatallah/typescript-npm-package-template
[semantic-release-img]: https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg
[semantic-release-url]: https://github.com/semantic-release/semantic-release
[commitizen-img]: https://img.shields.io/badge/commitizen-friendly-brightgreen.svg
[commitizen-url]: http://commitizen.github.io/cz-cli/
