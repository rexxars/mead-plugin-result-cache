/* eslint-disable id-length, no-sync */
const fs = require('fs')
const express = require('express')
const request = require('supertest')
const getMockCache = require('./mock-cache')
const resultCache = require('../')

const noop = () => true
const getApp = middleware => {
  const app = express()
    .use(middleware)
    .get('/*', (req, res) => res.send('Default'))

  app.locals.knownQueryParams = ['w', 'h', 'fit']
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
    .then(res => {
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
    .then(res => {
      expect(storage.read).toBeCalledWith({
        urlPath: 'images/foo.jpg',
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
    headers: {'Content-Type': 'text/plain', 'X-Custom': 'moop'}
  })

  return request(app)
    .get('/images/foo.jpg?w=200')
    .expect('Content-Type', 'text/plain')
    .expect('X-Custom', 'moop')
    .expect(200, 'Cached')
})

test('cache hits terminate response with returned info (stream)', () => {
  const storage = getMockCache()
  const [pre] = resultCache({storage})
  const app = getApp(pre.handler)

  storage.read.mockReturnValueOnce({
    body: fs.createReadStream(__filename),
    headers: {'Content-Type': 'text/plain', 'X-Custom': 'moop'}
  })

  return request(app)
    .get('/images/foo.jpg?w=200')
    .expect('Content-Type', 'text/plain')
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
    expect(logger.error).toHaveBeenCalledWith(
      `Failed to write to result cache:\n${error.stack}`
    )

    done()
  })
})
