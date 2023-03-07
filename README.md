# Redbase

A simple, fast, indexed, and type-safe database on top of Redis. Can be used as a queryable, browsable cache.

## Features

- **Simple**: less than 500 lines. No dependencies - for now, just `ioredis` as a peer. No modules. You can copy-paste the code if you want.
- **Fast**: Compared to optimized Postgres, 30% faster at scrolling or deleting unindexed data. See [benchmark](#benchmarks) considerations below.
- **Indexed**: Supports hierarchical [tags](#tags), a lightweight primitive for indexing your data.
- **Browsable**: browser-friendly API included for scrolling the database and browsing by tag.

_Non-features_

- No dependencies on Redis modules. Useful for deploying on platforms like [Upstash](https://upstash.com/).

- Never calls "KEYS" on redis instance, which is expensive. Uses simple [set theory](https://github.com/alexanderatallah/redbase/blob/main/src/database.ts#L437) to implement query logic.

In three lines:
```ts
import { Redbase } from 'redbase'
const db = new Redbase<MyDataType>('my-project')
const value = await db.get(id) // type: MyDataType
```

[![npm package][npm-img]][npm-url]
[![Downloads][downloads-img]][downloads-url]
[![Issues][issues-img]][issues-url]
[![Code Coverage][codecov-img]][codecov-url]
[![Commitizen Friendly][commitizen-img]][commitizen-url]
[![Semantic Release][semantic-release-img]][semantic-release-url]

- [Redbase](#redbase)
  - [Features](#features)
  - [Install](#install)
  - [Usage](#usage)
  - [Core concepts](#core-concepts)
    - [Entities](#entities)
    - [Tags](#tags)
  - [Benchmarks](#benchmarks)

## Install

```bash
npm install redbase
```

## Usage

```ts
import { Redbase } from 'redbase'

// Can use strings, numbers or buffers as well
type MyValue = {
  a: string
  b?: {
    c: string
  }
}

// Options can also use your own ioredis instance if already defined,
// as `redisInstance`
const db = new Redbase<MyValue>('myProject', { redisUrl: 'redis://...' })

const key = uuid()
const value = { a: 'result' }

await db.get(key) // undefined

await db.set(key, value)

await db.get(key) // value

// Type safety!

await db.set(key, { c: 'result2' }) // Type error on value

// Browsing results
let data = await db.entries()
assertDeepEquals(data, [{ id: key, value: { a: 'result' } }])

// Hierarchical indexes
await db.set(uuid(), { a: 'hi' }, ['user1/project1'])
await db.set(uuid(), { a: 'there' }, ['user1/project2'])
await db.set(uuid(), { a: 'bye' }, ['user2/project1'])

data = await db.filter()
assertEquals(data.length, 3)

data = await db.filter({ where: 'user1'})
assertEquals(data.length, 2)

const tags = await db.tags("user1")
assertEquals(tags.length, 2)
```

## Core concepts

There are two main concepts in Redbase: entities and tags.

### Entities

Entities are type-checked.

### Tags

Tags are ort of self-cleaning: indexes delete themselves during bulk-delete operations, and they shrink when entries are deleted individually.

## Benchmarks

[build-img]: https://github.com/alexanderatallah/redbase/actions/workflows/release.yml/badge.svg
[build-url]: https://github.com/alexanderatallah/redbase/actions/workflows/release.yml
[downloads-img]: https://img.shields.io/npm/dt/redbase
[downloads-url]: https://www.npmtrends.com/redbase
[npm-img]: https://img.shields.io/npm/v/redbase
[npm-url]: https://www.npmjs.com/package/redbase
[issues-img]: https://img.shields.io/github/issues/alexanderatallah/redbase
[issues-url]: https://github.com/alexanderatallah/redbase/issues
[codecov-img]: https://codecov.io/gh/alexanderatallah/redbase/branch/main/graph/badge.svg
[codecov-url]: https://codecov.io/gh/alexanderatallah/redbase
[semantic-release-img]: https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg
[semantic-release-url]: https://github.com/semantic-release/semantic-release
[commitizen-img]: https://img.shields.io/badge/commitizen-friendly-brightgreen.svg
[commitizen-url]: http://commitizen.github.io/cz-cli/
