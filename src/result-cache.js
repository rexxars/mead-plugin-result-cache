const express = require('express')
const objectHash = require('object-hash')
const pick = require('lodash/pick')

module.exports = config => {
  if (!config) {
    throw new Error('Result cache requires a configuration object')
  }

  if (!config.storage || !config.storage.read || !config.storage.write) {
    throw new Error(
      'Result cache requires a `storage`-parameter which has both a `read` and a `write` function'
    )
  }

  const logger = config.logger || console
  const storage = config.storage
  const logPipeError = err =>
    logger.error(`Error while piping cached body:\n${err.stack}`)

  const app = express()

  app.on('mount', function (parent) {
    this.locals = parent.locals || {}
    this.locals.config = this.locals.config || {}
  })

  app.get('/*', async (req, res, next) => {
    const path = req.path.slice(1).split('/')

    if (app.locals.config.sourceMode === 'path') {
      path.shift()
    }

    const urlPath = path.join('/')
    const queryParams = pick(req.query, app.locals.knownQueryParams)
    const shouldBeCached = Object.keys(queryParams).length > 0

    // If there are no transformations, it doesn't make sense to cache it
    if (!shouldBeCached) {
      next()
      return
    }

    // Create a cache key that is stable regardless of parameter order
    const paramsHash = objectHash(queryParams)

    // Check if this item is in cache
    const storageParams = {urlPath, paramsHash, queryParams}
    let cached

    // Errors during cache fetch shouldn't be fatal
    try {
      cached = await storage.read(storageParams)
    } catch (err) {
      logger.error(err)
    }

    // If we have a cached response, send it!
    if (cached) {
      res.writeHead(200, 'OK', cached.headers)

      if (cached.body && typeof cached.body.pipe === 'function') {
        cached.body.pipe(res).on('error', logPipeError)
      } else {
        res.end(cached.body)
      }

      return
    }

    // Not in cache. Set parameters as a way for the result handler to trigger a save
    res.locals.resultCacheParams = storageParams
    next()
  })

  const storeResult = async (options, next) => {
    // We don't want to halt the response from being sent, instead we trigger the save in the
    // background. This makes it impossible to send an error response if an error occurs in this
    // layer, but this should never be considered a fatal error - instead we will take a `logger`.
    next() // eslint-disable-line callback-return

    const params = options.response.locals.resultCacheParams
    if (!params) {
      return
    }

    const writeParams = Object.assign({}, params, {
      headers: options.headers,
      body: options.body
    })

    try {
      await storage.write(writeParams)
    } catch (err) {
      logger.error(
        `Failed to write to result cache:\n${err.stack || err.message}`
      )
    }
  }

  return [
    {
      type: 'middleware',
      name: 'result-cache',
      handler: app
    },
    {
      type: 'response-handler',
      name: 'result-cache',
      handler: storeResult
    }
  ]
}
