/* eslint-disable id-length, no-sync */
const fs = require('fs')
const express = require('express')
const request = require('supertest')
const getMockCache = require('./mock-cache')
const resultCache = require('../')

const noop = () => true
const getApp = (middleware, storeResult = noop) => {
  const app = express()
    .use((req, res, next) => {
      if (req.headers.origin) {
        res.vary('Origin')
      }
      next()
    })
    .use(middleware)
    .use((req, res, next) => {
      storeResult({response: res}, next)
      next()
    })
    .get('/*', (req, res) => {
      if (req.query.auto === 'format') {
        res.vary('Accept')
      }

      res.send('Default')
    })

  app.locals.knownQueryParams = ['w', 'h', 'fit', 'auto']
  return app
}

test('throws on missing configuration', () => {
  expect(resultCache).toThrow(/configuration/)
})

test('throws on missing `storage`', () => {
  expect(() => resultCache({})).toThrow(/storage/)
})

test('throws on missing `read`', () => {
  expect(() => resultCache({storage: {write: noop}})).toThrow(/read/)
})

test('throws on missing `write`', () => {
  expect(() => resultCache({storage: {read: noop}})).toThrow(/write/)
})

test('if there are no transformations to be done, read() is never called', () => {
  const storage = getMockCache()
  const [pre] = resultCache({storage})
  const app = getApp(pre.handler)

  return request(app)
    .get('/images/foo.jpg')
    .expect(200, 'Default')
    .then(() => {
      expect(storage.read).not.toBeCalled()
    })
})

test('if there are transformations, read() is called, trigger resize on miss', () => {
  const storage = getMockCache()
  const [pre] = resultCache({storage})
  const app = getApp(pre.handler)

  return request(app)
    .get('/images/foo.jpg?w=200')
    .expect(200, 'Default')
    .then(() => {
      expect(storage.read).toBeCalledWith({
        urlPath: 'images/foo.jpg',
        paramsHash: '03d62e8fc7b3d1b9179024d97d6f6360a240a48d',
        queryParams: {w: '200'}
      })
    })
})

test('strips source from path if `path` sourcemode is used', () => {
  const storage = getMockCache()
  const [pre] = resultCache({storage})
  const app = getApp(pre.handler)
  app.locals.config = {sourceMode: 'path'}

  return request(app)
    .get('/foo/bar/baz.jpg?w=200')
    .expect(200, 'Default')
    .then(() => {
      expect(storage.read).toBeCalledWith({
        urlPath: 'bar/baz.jpg',
        paramsHash: '03d62e8fc7b3d1b9179024d97d6f6360a240a48d',
        queryParams: {w: '200'}
      })
    })
})

test('runs url rewriting plugins, if any', () => {
  const storage = getMockCache()
  const [pre] = resultCache({storage})
  const app = getApp(pre.handler)
  app.locals.config = {sourceMode: 'path'}
  app.locals.plugins = {
    'url-rewriter': {
      'bar-remover': urlPath => urlPath.replace(/^\/?bar\//g, '')
    }
  }

  return request(app)
    .get('/foo/bar/baz.jpg?w=200')
    .expect(200, 'Default')
    .then(() => {
      expect(storage.read).toBeCalledWith({
        urlPath: 'baz.jpg',
        paramsHash: '03d62e8fc7b3d1b9179024d97d6f6360a240a48d',
        queryParams: {w: '200'}
      })
    })
})

test('cache hits terminate response with returned info', () => {
  const storage = getMockCache()
  const [pre] = resultCache({storage})
  const app = getApp(pre.handler)

  storage.read.mockReturnValueOnce({
    body: Buffer.from('Cached'),
    headers: {'Content-Type': 'text/plain; charset=iso-8859-1', 'X-Custom': 'moop'}
  })

  return request(app)
    .get('/images/foo.jpg?w=200')
    .expect('Content-Type', 'text/plain; charset=iso-8859-1')
    .expect('X-Custom', 'moop')
    .expect(200, 'Cached')
})

test('cache hits return hit header if includeHitHeaderHint is true', () => {
  const storage = getMockCache()
  const [pre] = resultCache({storage, includeHitHeaderHint: true})
  const app = getApp(pre.handler)

  storage.read.mockReturnValueOnce({
    body: Buffer.from('Cached'),
    headers: {'Content-Type': 'text/plain; charset=iso-8859-1', 'X-Custom': 'moop'}
  })

  return request(app)
    .get('/images/foo.jpg?w=200')
    .expect('Content-Type', 'text/plain; charset=iso-8859-1')
    .expect('X-Custom', 'moop')
    .expect('X-Result-Cache', 'hit')
    .expect(200, 'Cached')
})

test('cache misses do not return hit header if includeHitHeaderHint is true', () => {
  const storage = getMockCache()
  const [pre] = resultCache({storage, includeHitHeaderHint: true})
  const app = getApp(pre.handler)

  return request(app)
    .get('/images/foo.jpg?w=200')
    .expect(200, 'Default')
    .then(res => {
      expect(res.headers).not.toHaveProperty('X-Result-Cache')
    })
})

test('cache hits terminate response with returned info (stream)', () => {
  const storage = getMockCache()
  const [pre] = resultCache({storage})
  const app = getApp(pre.handler)

  storage.read.mockReturnValueOnce({
    body: fs.createReadStream(__filename),
    headers: {'Content-Type': 'text/plain; charset=iso-8859-1', 'X-Custom': 'moop'}
  })

  return request(app)
    .get('/images/foo.jpg?w=200')
    .expect('Content-Type', 'text/plain; charset=iso-8859-1')
    .expect('X-Custom', 'moop')
    .expect(200, fs.readFileSync(__filename, 'utf8'))
})

test('storing results calls next even if told not to cache', done => {
  const storage = getMockCache()
  const [, post] = resultCache({storage})
  const options = {response: {locals: {}}}
  post.handler(options, done)
})

test('storing results calls next PRIOR to write', done => {
  const storage = getMockCache()
  const [, post] = resultCache({storage})
  const resultCacheParams = {}
  const options = {response: {locals: {resultCacheParams}}}

  let nextCalled = false

  storage.write.mockImplementation(() => {
    expect(nextCalled).toBe(true)
    done()
  })

  post.handler(options, () => {
    nextCalled = true
  })
})

test('logs errors on write', done => {
  const logger = {error: jest.fn()}
  const storage = getMockCache()
  const [, post] = resultCache({storage, logger})
  const resultCacheParams = {}
  const options = {response: {locals: {resultCacheParams}}}
  const error = new Error('Storage error')

  storage.write.mockReturnValueOnce(Promise.reject(error))
  post.handler(options, noop)

  process.nextTick(() => {
    expect(logger.error).toHaveBeenCalledWith(`Failed to write to result cache:\n${error.stack}`)

    done()
  })
})

test('auto=format creates different hash based on accept header (blank)', () => {
  const storage = getMockCache()
  const [pre] = resultCache({storage})
  const app = getApp(pre.handler)

  return request(app)
    .get('/images/foo.jpg?w=200&auto=format')
    .expect('Vary', 'Accept')
    .expect(200, 'Default')
    .then(() => {
      expect(storage.read).toBeCalledWith({
        urlPath: 'images/foo.jpg',
        paramsHash: '1cedfee6e413463b212d2f8fb3fe826450dd8d0e',
        queryParams: {w: '200', auto: 'format', __autoFormat: 'default'}
      })
    })
})

test('auto=format creates different hash based on accept header (webp)', () => {
  const storage = getMockCache()
  const [pre] = resultCache({storage})
  const app = getApp(pre.handler)

  return request(app)
    .get('/images/foo.jpg?w=200&auto=format')
    .set('Accept', 'image/webp,image/*')
    .expect(200, 'Default')
    .expect('Vary', 'Accept')
    .then(() => {
      expect(storage.read).toBeCalledWith({
        urlPath: 'images/foo.jpg',
        paramsHash: '22cd718c6f3be48d1ad95134aab51555fe1ff472',
        queryParams: {w: '200', auto: 'format', __autoFormat: 'webp'}
      })
    })
})

test('merges vary headers (miss)', () => {
  const storage = getMockCache()
  const [pre, post] = resultCache({storage})
  const app = getApp(pre.handler, post.handler)

  return request(app)
    .get('/images/foo.jpg?w=200&auto=format')
    .set('Origin', 'https://www.sanity.io')
    .expect(200, 'Default')
    .expect('Vary', 'Origin, Accept')
    .then(() => {
      expect(storage.read).toBeCalledWith({
        urlPath: 'images/foo.jpg',
        paramsHash: '1cedfee6e413463b212d2f8fb3fe826450dd8d0e',
        queryParams: {w: '200', auto: 'format', __autoFormat: 'default'}
      })
    })
})

test('merges vary headers (hit)', () => {
  const storage = getMockCache()
  const [pre, post] = resultCache({storage, includeHitHeaderHint: true})
  const app = getApp(pre.handler, post.handler)

  storage.read.mockReturnValueOnce({
    body: Buffer.from('Cached'),
    headers: {'Content-Type': 'text/plain; charset=iso-8859-1', vary: 'Accept'}
  })

  return request(app)
    .get('/images/foo.jpg?w=200&auto=format')
    .set('Origin', 'https://www.sanity.io')
    .expect(200, 'Cached')
    .expect('X-Result-Cache', 'hit')
    .expect('Vary', 'Origin, Accept')
    .then(() => {
      expect(storage.read).toBeCalledWith({
        urlPath: 'images/foo.jpg',
        paramsHash: '1cedfee6e413463b212d2f8fb3fe826450dd8d0e',
        queryParams: {w: '200', auto: 'format', __autoFormat: 'default'}
      })
    })
})
