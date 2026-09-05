/**
 * DSH Dock HTTP client. Wraps the loopback REST service with the plugin's
 * error contract: connection failures become a `service-unreachable` error
 * whose hint names the exact fix (`dshdock bg`), server errors pass through
 * their message with an actionable hint where the status/code is known.
 * Every request carries a connect timeout (3s); wait polling threads the
 * caller's `exec.signal` through so cancellation stops the loop.
 */
const CONNECT_TIMEOUT_MS = 3000

/** One DSH Dock REST failure carrying machine code, message, and a fix hint. */
export class DockError extends Error {
  /**
   * @param message - human-readable failure, safe to show to the model.
   * @param facts - machine code, matching HTTP status when known, and a hint.
   */
  constructor(message, { code = 'dock-error', status, hint, data } = {}) {
    super(message)
    this.name = 'DockError'
    this.code = code
    this.status = status
    this.hint = hint
    this.data = data
  }
}

const SERVICE_DOWN_HINT = '请在宿主机运行 `dshdock bg` 启动 DSH Dock 服务;若服务已在运行,请检查本插件配置里的服务地址(baseUrl)。'

/**
 * Build the shared client used by tools, the page channel, and probes.
 * @param baseUrl - DSH Dock service base URL, without a trailing slash.
 * @returns `{ request, baseUrl }`.
 */
export function createDockClient(baseUrl) {
  /**
   * Perform one REST call against the service.
   * @param method - HTTP method.
   * @param apiPath - absolute path below `/api`.
   * @param options - JSON body, per-request timeout override, caller signal.
   * @returns the parsed JSON body.
   * @throws {DockError} on connection failure or a non-2xx answer.
   */
  async function request(method, apiPath, { body, timeoutMs = CONNECT_TIMEOUT_MS, signal } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error(`连接超时(${timeoutMs}ms)`)), timeoutMs)
    const onOuterAbort = () => controller.abort(new Error('调用方取消'))
    if (signal !== undefined) {
      if (signal.aborted) {
        clearTimeout(timer)
        throw new DockError('调用已取消', { code: 'cancelled' })
      }
      signal.addEventListener('abort', onOuterAbort, { once: true })
    }
    let response
    try {
      response = await fetch(baseUrl + apiPath, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      const cancelled = signal?.aborted === true
      if (cancelled) throw new DockError('调用已取消', { code: 'cancelled' })
      throw new DockError(`DSH Dock 服务未运行(${baseUrl}): ${error instanceof Error ? error.message : String(error)}`, {
        code: 'service-unreachable',
        hint: SERVICE_DOWN_HINT,
      })
    } finally {
      clearTimeout(timer)
      if (signal !== undefined) signal.removeEventListener('abort', onOuterAbort)
    }
    const text = await response.text()
    let data = null
    if (text.length > 0) {
      try { data = JSON.parse(text) } catch { data = { raw: text.slice(0, 2000) } }
    }
    if (!response.ok) throw mapHttpError(response.status, data)
    return data
  }

  return { request, baseUrl }
}

/** Map one non-2xx service answer to the plugin's error contract. */
function mapHttpError(status, data) {
  const message = (data !== null && typeof data === 'object' && typeof data.error === 'string')
    ? data.error
    : `DSH Dock 返回 HTTP ${status}`
  const facts = { status, data }
  if (status === 409 && data !== null && typeof data === 'object' && data.needsOnboarding === true) {
    facts.code = 'onboarding'
    facts.hint = 'DSH Dock 尚未完成部署目录引导:请在浏览器打开 DSH Dock WebUI 完成首次引导后再试。'
  } else if (status === 404) {
    facts.code = 'not-found'
    facts.hint = '目标不存在(容器/版本/接口路径)。可用 dshdock_containers 或 dshdock_versions 先确认名称。'
  } else if (status === 400) {
    facts.code = 'bad-request'
    if (data !== null && typeof data === 'object' && data.needConfirm === true) {
      facts.code = 'need-confirm'
      facts.hint = '该容器开启了开发保护(devProtect),服务端要求删除前显式确认;工具以 confirm=true 满足该门禁。'
    }
  } else if (status === 500) {
    facts.code = 'server-error'
    facts.hint = 'DSH Dock 服务内部错误,详情见其日志(宿主机 logs/dshdock.log)。'
  }
  return new DockError(message, facts)
}

/**
 * Extract the model-facing JSON facts from a thrown error.
 * @param error - anything thrown by a tool step.
 * @returns `{ error, hint?, code? }` — `ok: false` payload fields.
 */
export function errorFacts(error) {
  if (error instanceof DockError) {
    const facts = { error: error.message }
    if (error.hint !== undefined) facts.hint = error.hint
    if (error.code !== undefined) facts.code = error.code
    return facts
  }
  return { error: error instanceof Error ? error.message : String(error) }
}
