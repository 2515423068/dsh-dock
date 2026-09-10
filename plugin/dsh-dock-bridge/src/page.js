/**
 * The `/dshdock-plugins` page channel (design §3.7): the browser half of the
 * "DSH Dock" settings section talks to this handler over the generic
 * connection RPC channel (browser-trust fence applied by the connection
 * layer). Container/version/settings/template operations proxy an
 * allowlisted subset of the DSH Dock REST service verbatim, so the server's
 * own gates (busy / devProtect / port pool) stay authoritative.
 */
import { probeService } from './env.js'
import { DockError, errorFacts } from './http.js'
import { readPatchText, setEntryConfig, writePatchText } from './patch.js'

const BRIDGE_ROW_ID = 'dshdock-bridge'

/** Path prefixes the `dock.rest` proxy may forward; everything else is 403. */
const REST_ALLOWLIST = [
  '/api/containers',
  '/api/versions',
  '/api/settings',
  '/api/profile-template',
  '/api/tasks',
]

/** Endpoints that mutate a container and therefore need the self guard. */
function selfGuard(pathname, method, payload, selfId) {
  if (selfId === null) return null
  const match = pathname.match(/^\/api\/containers\/([^/]+)(\/.*)?$/)
  if (match === null) return null
  const id = decodeURIComponent(match[1])
  const action = match[2] ?? ''
  const destructive = (method === 'DELETE' && action === '')
    || (method === 'POST' && (action === '/stop' || action === '/update'))
  if (!destructive || id !== selfId) return null
  if (payload !== null && typeof payload === 'object' && payload.force === true) return null
  return {
    code: 'self-protected',
    message: `拒绝:容器 ${id} 是当前会话所在的容器,该操作会杀死本会话`,
    hint: '页面已弹出强警告;确需继续请在确认弹窗中勾选"我了解后果"后再执行(等价于工具的 force=true)。',
  }
}

/**
 * Build the RPC handler for the page channel.
 * @param facts - shared request fn, current baseUrl, profile dir, self id.
 * @returns the handler: `(endpoint, payload, signal) => ConnectionRpcResult`.
 */
export function createPageHandler({ request, baseUrl, profileDir, selfId }) {
  return async function handle(endpoint, payload, signal) {
    const body = (payload !== null && typeof payload === 'object') ? payload : {}
    try {
      switch (endpoint) {
        case 'dock.status': {
          const reachable = await probeService(request)
          return ok({
            dshdockContainer: selfId !== null,
            selfContainerId: selfId ?? undefined,
            serviceReachable: reachable,
            baseUrl,
          })
        }
        case 'dock.rest': {
          const method = typeof body.method === 'string' ? body.method : 'GET'
          const pathname = typeof body.path === 'string' ? body.path : ''
          if (!REST_ALLOWLIST.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
            return fail({ code: 'forbidden', message: `路径不在允许列表内: ${pathname}`, details: {} })
          }
          const guard = selfGuard(pathname, method, body.body ?? {}, selfId)
          if (guard !== null) return fail(guard)
          try {
            const answer = await request(method, pathname, {
              body: body.body,
              timeoutMs: method === 'DELETE' ? 60000 : (method === 'POST' && /\/stop$/.test(pathname) ? 30000 : 15000),
              signal,
            })
            return ok({ status: 200, body: answer })
          } catch (error) {
            if (error instanceof DockError && error.status !== undefined) {
              return ok({ status: error.status, body: { error: error.message, ...(error.data ?? {}) } })
            }
            const facts = errorFacts(error)
            return ok({ status: 0, body: facts })
          }
        }
        case 'dock.baseUrl': {
          const next = typeof body.baseUrl === 'string' ? body.baseUrl.trim().replace(/\/+$/, '') : ''
          if (!/^https?:\/\//.test(next)) {
            return fail({ code: 'bad-request', message: `服务地址必须是 http(s) URL: ${next}`, details: {} })
          }
          const text = readPatchText(profileDir)
          const result = setEntryConfig(text, BRIDGE_ROW_ID, { baseUrl: next })
          if (result === null) {
            return fail({ code: 'not-found', message: `没有找到本插件的 patch 行(${BRIDGE_ROW_ID})`, details: {} })
          }
          writePatchText(profileDir, result.text)
          return ok({ baseUrl: next, reloaded: true })
        }
        default:
          return fail({ code: 'not-found', message: `未知端点: ${endpoint}`, details: {} })
      }
    } catch (error) {
      const facts = errorFacts(error)
      return fail({ code: facts.code ?? 'internal', message: facts.error, details: facts.hint !== undefined ? { hint: facts.hint } : {} })
    }
  }
}

function ok(value) {
  return { ok: true, value }
}

function fail(error) {
  return { ok: false, error }
}
