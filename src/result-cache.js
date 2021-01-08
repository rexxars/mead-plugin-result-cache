const express = require('express')
const objectHash = require('object-hash')
const omit = require('lodash/omit')
const pick = require('lodash/pick')
const values = require('lodash/values')
const pump = require('pump')

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
  const includeHitHeaderHint = Boolean(config.includeHitHeaderHint)
  const logPipeError = err => {
    if (err) {
      logger.error(`Error while piping cached body:\n${err.stack}`)
    }
  }

  const app = express()

  app.on('mount', function(parent) {
    this.locals = parent.locals || {}
    this.locals.config = this.locals.config || {}
    this.locals.plugins = this.locals.plugins || {}
  })

  app.get('/*', async (req, res, next) => {
    const path = req.path.slice(1).split('/')

    if (app.locals.config.sourceMode === 'path') {
      path.shift()
    }

    const urlRewriters = values(app.locals.plugins['url-rewriter'] || {})
    const urlPath = urlRewriters.reduce((current, rewriter) => rewriter(current), path.join('/'))

    const queryParams = pick(req.query, app.locals.knownQueryParams)
    const shouldBeCached = Object.keys(queryParams).length > 0

    // If there are no transformations, it doesn't make sense to cache it
    if (!shouldBeCached) {
      next()
      return
    }

    // If we have `auto` set to `format`, we need to create different
    // keys for different accepted formats (image/webp, image/avif)
    if (queryParams.auto === 'format') {
      const enabled = app.locals.config.images.enableAvif
        ? ['image/avif', 'image/webp']
        : ['image/webp']

      const accept = req.headers.accept || ''
      const formats = accept.split(',').map(fm => fm.trim())
      const preferred = formats.find(fm => enabled.includes(fm))

      // Signal "internal" to prevent crashing with any future query params
      queryParams.__autoFormat = 'default'

      if (preferred === 'image/avif') {
        queryParams.__autoFormat = 'avif'
      } else if (preferred === 'image/webp') {
        queryParams.__autoFormat = 'webp'
      }
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
      const headers = normalizeHeaders(addCacheHintHeader(cached.headers, 'hit'))
      const vary = headers.vary

      res.set(omit(headers, ['vary']))
      if (vary) {
        res.vary(vary)
      }

      if (cached.body && typeof cached.body.pipe === 'function') {
        pump(cached.body, res, logPipeError)
      } else {
        res.send(cached.body)
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

    const body = options.body
    const vary = options.response.getHeader && options.response.getHeader('vary')
    const headers = Object.assign(
      body ? {'content-length': body.length} : {},
      vary ? {vary} : {},
      options.headers
    )

    try {
      await storage.write(Object.assign({}, params, {headers, body}))
    } catch (err) {
      logger.error(`Failed to write to result cache:\n${err.stack || err.message}`)
    }
  }

  function addCacheHintHeader(headers, value) {
    if (!includeHitHeaderHint) {
      return headers
    }

    return Object.assign({}, headers, {
      'x-result-cache': value
    })
  }

  function normalizeHeaders(headers) {
    return Object.keys(headers).reduce((set, header) => {
      set[header.toLowerCase()] = headers[header]
      return set
    }, {})
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
