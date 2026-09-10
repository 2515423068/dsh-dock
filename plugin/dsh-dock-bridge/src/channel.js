/**
 * Host half of the `/dshdock-plugins` page channel.
 *
 * The route is mounted directly on the web server rather than through
 * `connection.rpc.handle`. DSH v0.1.5 dropped `webServer` from Connection's own
 * `inject` list (it now mounts its `/api` route from an internal
 * `ctx.inject(['webServer'], …)`), while `rpc.handle` resolves `webServer`
 * against the *Connection provider's* context. That context no longer declares
 * webServer, so every `rpc.handle` call fails with `cannot get property
 * "webServer" without inject` and the channel never mounts (the browser then
 * sees the SPA fallback's HTTP 405 for the POST).
 *
 * Mounting here keeps the exact wire contract the browser half already uses:
 * the same browser-trust and session fence (`requestRejection`, the public
 * Connection API the official `/api` route and the Gateway WebSocket route both
 * apply) plus Connection's `client-request` / `server-response` JSON envelopes.
 * The page handler keeps its `(endpoint, payload, signal)` result shape.
 */

const CHANNEL = '/dshdock-plugins'
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/
const INVALID_REQUEST_RPC_ID = 'invalid-request'
/** Page-channel payloads are small settings/ids; this only bounds a hostile body. */
const MAX_BODY_BYTES = 1024 * 1024

/**
 * Mount the page channel as a Web route owned by the caller's effect scope.
 * @param facts - the reading scope's Connection and Web server services, and
 * the decoded-endpoint handler.
 * @returns the web-server disposer removing the route.
 */
export function mountPageChannel({ connection, webServer, handler }) {
  return webServer.register({
    kind: 'prefix',
    path: CHANNEL,
    handler: async (req, res) => {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) {
        res.writeHead(rejection)
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      await dispatch(req, res, handler)
    },
  })
}

/**
 * Decode one Connection RPC request, run the page handler, and write the
 * matching server-response envelope.
 * @param req - the node:http request below the channel prefix.
 * @param res - the response this function owns to completion.
 * @param handler - decoded-endpoint handler `(endpoint, payload, signal)`.
 */
async function dispatch(req, res, handler) {
  const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
  const endpoint = endpointFromPath(pathname)
  if (req.method !== 'POST' || endpoint === undefined) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  const mediaType = (req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
  if (mediaType !== 'application/json') {
    res.writeHead(415)
    res.end('content type must be application/json')
    return
  }
  let body
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    res.writeHead(400)
    res.end('body is not JSON')
    return
  }
  const record = (body !== null && typeof body === 'object') ? body : {}
  const rpcId = typeof record.rpcId === 'string' ? record.rpcId : INVALID_REQUEST_RPC_ID
  if (record.type !== 'client-request' || typeof record.method !== 'string') {
    sendEnvelope(res, { type: 'server-response', rpcId, result: failure('gateway/bad-request', 'invalid client-request message') })
    return
  }
  if (record.method !== endpoint) {
    sendEnvelope(res, {
      type: 'server-response',
      rpcId,
      result: failure('gateway/bad-request', `method ${JSON.stringify(record.method)} does not match endpoint ${JSON.stringify(endpoint)}`),
    })
    return
  }
  // A dropped client aborts an in-flight REST proxy call, same as the official
  // carrier: 'close' on the response distinguishes a normal end from teardown.
  const abort = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) abort.abort()
  })
  let result
  try {
    result = await handler(endpoint, record.payload ?? null, abort.signal)
  } catch (error) {
    res.writeHead(500)
    res.end(`handler failure: ${String(error)}`)
    return
  }
  sendEnvelope(res, { type: 'server-response', rpcId, result })
}

/** Read the request body, rejecting a body over {@link MAX_BODY_BYTES}. */
async function readBody(req) {
  const chunks = []
  let received = 0
  for await (const chunk of req) {
    const buffer = chunk
    received += buffer.byteLength
    if (received > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function sendEnvelope(res, envelope) {
  const text = JSON.stringify(envelope)
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(text)
}

function failure(code, message) {
  return { ok: false, error: { code, message, details: {} } }
}

/** Channel-relative endpoint for a pathname, or undefined when it is not one. */
function endpointFromPath(pathname) {
  if (!pathname.startsWith(`${CHANNEL}/`)) return undefined
  const endpoint = pathname.slice(CHANNEL.length + 1)
  const segments = endpoint.split('/')
  if (segments.some(segment =>
    segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    return undefined
  }
  return endpoint
}
