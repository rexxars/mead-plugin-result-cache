module.exports = () => {
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

  return {read, write, __cache: cache}
}
