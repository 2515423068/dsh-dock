/**
 * dsh-dock-bridge — Host half of the DSH Dock bridge plugin.
 *
 * Function plugin (named exports `name` / `inject` / `apply`; no default
 * export). Provides, inside any container it is installed into:
 * - nine `dshdock_*` model tools over the DSH Dock REST service,
 * - the `dshdock` skill,
 * - the `/dshdock-plugins` page channel the browser "DSH Dock" settings
 *   section talks to (web profile only).
 *
 * The tools service is a hard dependency (`inject: ['tools']`); connection
 * and skills are read with `ctx.get` and skipped when absent (headless
 * profiles have no connection; some compositions ship no skills registry).
 */
import { fileURLToPath } from 'node:url'
import { detectSelf } from './env.js'
import { createDockClient } from './http.js'
import { createPageHandler } from './page.js'
import { skillDefinition } from './skill.js'
import { createTools } from './tools.js'

export const name = 'dshdock-bridge'

export const inject = ['tools']

/**
 * Resolve and validate the plugin config (no schemastery dependency by
 * design; misconfiguration fails loud at activation).
 * @param config - the raw patch-line config object.
 * @returns `{ baseUrl }` without a trailing slash.
 */
function resolveConfig(config) {
  const raw = (config !== null && typeof config === 'object') ? config : {}
  const baseUrl = raw.baseUrl ?? process.env.DSHDOCK_URL ?? 'http://127.0.0.1:7940'
  if (typeof baseUrl !== 'string') {
    throw new Error(`dshdock-bridge 配置错误:baseUrl 必须是字符串,收到 ${typeof baseUrl}`)
  }
  let parsed
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error(`dshdock-bridge 配置错误:baseUrl 不是合法 URL: ${JSON.stringify(baseUrl)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`dshdock-bridge 配置错误:baseUrl 必须是 http(s) URL: ${baseUrl}`)
  }
  return { baseUrl: baseUrl.replace(/\/+$/, '') }
}

/**
 * Plugin entry.
 * @param ctx - cordis plugin context (baseUrl = the profile directory).
 * @param config - the patch-line config (`baseUrl`).
 */
export function apply(ctx, config) {
  const settings = resolveConfig(config)
  const client = createDockClient(settings.baseUrl)
  const self = detectSelf()
  const selfId = self?.selfId ?? null

  for (const tool of createTools(client.request, selfId)) {
    ctx.tools.register(tool)
  }

  const skills = ctx.get('skills')
  if (skills !== undefined) {
    ctx.effect(() => skills.register(skillDefinition()), 'dshdock-bridge: skill')
  }

  // The connection service activates after this row (bundle rows load first,
  // but activation order is not guaranteed), so register the page channel in
  // an injection scope that waits for it. In a composition that never
  // provides connection (headless), the scope stays pending and the channel
  // is simply absent — tools remain unaffected.
  if (ctx.baseUrl === undefined) return
  const profileDir = fileURLToPath(ctx.baseUrl)
  ctx.inject(['connection'], (scope) => {
    scope.effect(
      () => scope.connection.rpc.handle('/dshdock-plugins', createPageHandler({
        request: client.request,
        baseUrl: settings.baseUrl,
        profileDir,
        selfId,
      })),
      'dshdock-bridge: page channel',
    )
  })
}
