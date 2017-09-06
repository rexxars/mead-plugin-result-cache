# mead-plugin-result-cache

[![npm version](http://img.shields.io/npm/v/mead-plugin-result-cache.svg?style=flat-square)](http://browsenpm.org/package/mead-plugin-result-cache)[![Build Status](http://img.shields.io/travis/rexxars/mead-plugin-result-cache/master.svg?style=flat-square)](https://travis-ci.org/rexxars/mead-plugin-result-cache)[![Dependency status](https://img.shields.io/david/rexxars/mead-plugin-result-cache.svg?style=flat-square)](https://david-dm.org/rexxars/mead-plugin-result-cache)

Caches the result of transformations. Pluggable storage implementation.

## Installation

```
npm install --save mead-plugin-result-cache
```

## Usage

Your mead configuration file (`mead --config <path-to-config.js>`):

```js
const resultCache = require('mead-plugin-result-cache')

module.exports = {
  // Load the plugin and specify configuration
  plugins: [
    resultCache({
      storage: inMemoryStorage,
      logger: console
    })
  ]
}
```

## Storage adapters

The `storage` takes an object with a `read` and a `write` function, each of which returns a promise.
A super-naive, in-memory implementation of this pattern (which should obviously never ever be used) looks something like this:

```js
const cache = {}

const read = ({urlPath, paramsHash}) => {
  const cacheKey = `${urlPath}-${paramsHash}`
  return cache[cacheKey]
}

const write = ({urlPath, paramsHash, headers, body}) => {
  const cacheKey = `${urlPath}-${paramsHash}`
  cache[cacheKey] = {headers, body}
  return true
}
```

### `read(options)`

Receives an options object containing the following properties:

- `urlPath` - Request path without query string. `/foo/bar.jpg?w=200` would set `urlPath` to `foo/bar.jpg`.
- `paramsHash` - A hashed value of the sorted query parameters
- `queryParams` - The query parameters used to transform this image

Returns a promise (or a plain value) which resolves to an object containing:

- `headers` - HTTP headers for the response
- `body` - Body of the response. Can be either a `Buffer` or a `ReadableStream`.

If the promise is resolved with a falsey value, a cache miss is inferred and will trigger normal resizing. Rejected promises are logged using the passed `logger`.

### `write(options)`

Receives an options object containing the following properties:

- `urlPath` - Request path without query string. `/foo/bar.jpg?w=200` would set `urlPath` to `foo/bar.jpg`.
- `paramsHash` - A hashed value of the sorted query parameters
- `queryParams` - The query parameters used to transform this image
- `headers` - HTTP headers for the response
- `body` - Body of the response, as a `Buffer`.

Returns a promise, return value is not used. Rejected promises are logged using the passed `logger`.

## Logger

The `logger` parameter takes an object containg logging methods that corresponds to `Log4j` console methods (`console.error`, `console.warn`, `console.info`, `console.debug`, `console.trace`). Defaults to `console`.

## License

MIT-licensed. See LICENSE.
