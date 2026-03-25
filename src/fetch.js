import nodeFetch from 'node-fetch'

export const fetchImpl = typeof globalThis.fetch === 'function'
  ? globalThis.fetch.bind(globalThis)
  : nodeFetch
