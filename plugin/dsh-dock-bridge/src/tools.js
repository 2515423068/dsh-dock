/**
 * The nine dshdock_* model tools (design §3.3): high-frequency container and
 * version operations over the DSH Dock REST service. Every tool returns a
 * flat JSON object — `ok` plus a tool-specific payload, or `ok: false` with
 * `error` + `hint` — so the model can branch on the shape without parsing
 * prose. Long operations support `wait`: true blocks on the task record
 * (1s polling) until the task settles or the tool's budget ends; a budget
 * exhaustion returns the still-running task with recent lines.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DockError, errorFacts } from './http.js'
import { pollBudget, tailLines, waitTask } from './wait.js'

/** Shared output fields: every tool returns `ok` plus optional failure facts. */
const RESULT_BASE = {
  ok: { type: 'boolean', required: true },
  error: { type: 'string' },
  hint: { type: 'string' },
  code: { type: 'string' },
}

const CONTAINER_ROW = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    version: { type: 'string' },
    profile: { type: 'string' },
    port: { type: 'integer' },
    devProtect: { type: 'boolean' },
    status: { type: 'string', enum: ['running', 'starting', 'stopped', 'failed'], required: true },
    url: { type: 'string' },
    createdAt: { type: 'integer' },
    self: { type: 'boolean', required: true },
  },
}

const TASK_ROW = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    kind: { type: 'string', required: true },
    refId: { type: 'string' },
    label: { type: 'string', required: true },
    status: { type: 'string', enum: ['running', 'succeeded', 'failed'], required: true },
    error: { type: 'string' },
    startedAt: { type: 'integer' },
    finishedAt: { type: 'integer' },
    lines: { type: 'array', items: { type: 'string' } },
  },
}

/** Shallow-strip `undefined` values so the canonical output matches its schema. */
function clean(value) {
  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry
  }
  return out
}

/** Drop unknown/absent fields from one server container row before returning it. */
function containerRow(raw, selfId) {
  const row = {
    id: raw.id,
    name: raw.name ?? raw.id,
    self: raw.id === selfId,
    status: raw.status,
  }
  if (typeof raw.version === 'string') row.version = raw.version
  if (typeof raw.profile === 'string') row.profile = raw.profile
  if (typeof raw.port === 'number') row.port = raw.port
  if (typeof raw.devProtect === 'boolean') row.devProtect = raw.devProtect
  if (typeof raw.url === 'string') row.url = raw.url
  if (typeof raw.createdAt === 'number') row.createdAt = raw.createdAt
  return row
}

/** Drop fields the tool schema does not declare from one server task record. */
function taskRow(raw, maxLines) {
  const row = {
    id: raw.id,
    kind: raw.kind,
    label: raw.label ?? '',
    status: raw.status,
    lines: tailLines(raw.lines, maxLines),
  }
  if (typeof raw.refId === 'string') row.refId = raw.refId
  if (typeof raw.error === 'string' && raw.error.length > 0) row.error = raw.error
  if (typeof raw.startedAt === 'number') row.startedAt = raw.startedAt
  if (typeof raw.finishedAt === 'number') row.finishedAt = raw.finishedAt
  return row
}

/** Resolve a container reference (id or name) to its server row. */
async function resolveContainer(request, ref) {
  const list = await request('GET', '/api/containers')
  const target = list.find(entry => entry.id === ref) ?? list.find(entry => entry.name === ref)
  if (target === undefined) {
    throw new DockError(`容器不存在: ${ref}`, {
      code: 'not-found',
      hint: '用 dshdock_containers 查看现有容器的 id 与名称(两者都可作为 container 参数)。',
    })
  }
  return target
}

/** Refuse stop/update/delete against the container this session lives in. */
function assertNotSelfMutation(target, action, force, selfId) {
  if (selfId !== null && target.id === selfId && force !== true) {
    throw new DockError(`拒绝:容器 ${target.name}(${target.id})是当前会话所在的容器,${action} 会杀死本会话`, {
      code: 'self-protected',
      hint: '确需继续请显式传入 force=true(会话将断线);更稳妥的做法是交给用户在 WebUI 操作,并给该容器开启开发保护(devProtect)。',
    })
  }
}

/**
 * Create the nine tool definitions bound to one shared client and self id.
 * @param request - shared HTTP client request function.
 * @param selfId - self container id, or `null` on an independent DSH.
 * @returns the tool definitions, in registration order.
 */
export function createTools(request, selfId) {
  /** Run one tool body and fold any failure into the `ok: false` payload. */
  const run = async (body) => {
    try {
      return await body()
    } catch (error) {
      if (error instanceof DockError && error.code === 'cancelled') throw error
      return { ok: false, ...errorFacts(error) }
    }
  }

  /** Poll one long task and translate the outcome into a result payload. */
  const finishWaitable = async (request2, kind, refId, toolTimeoutMs, okPayload, signal) => {
    const { task, timedOut } = await waitTask(request2, kind, refId, {
      timeoutMs: pollBudget(toolTimeoutMs),
      signal,
    })
    if (timedOut) {
      return clean({
        ...okPayload,
        status: 'running',
        taskId: task?.id,
        lines: tailLines(task?.lines, 15),
        hint: '任务仍在进行(等待超时,非失败)。可用 dshdock_tasks { refId } 续看进度,或稍后重试本工具。',
      })
    }
    if (task === undefined) {
      return clean({
        ...okPayload,
        status: 'succeeded',
        hint: '任务记录已不可见(可能已被清理),按成功处理;可用 dshdock_containers 复核实际状态。',
      })
    }
    if (task.status === 'failed') {
      return clean({
        ...okPayload,
        ok: false,
        status: 'failed',
        taskId: task.id,
        error: typeof task.error === 'string' ? task.error : '任务失败(无错误详情)',
        lines: tailLines(task.lines, 15),
      })
    }
    return clean({ ...okPayload, status: 'succeeded', taskId: task.id, lines: tailLines(task.lines, 15) })
  }

  const WAIT_PARAM = { type: 'boolean', description: '等待任务完成后再返回(默认 true);false 时立即返回任务句柄,交给 dshdock_tasks 兜底观察。' }

  const tools = [
    defineTool({
      name: 'dshdock_containers',
      description: 'List DSH Dock containers: id, name, version, profile, port, status, tokenized web URL, devProtect; marks which container is the current session (self).',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...RESULT_BASE,
            selfContainerId: { type: 'string' },
            containers: { type: 'array', items: CONTAINER_ROW },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      isConcurrencySafe: () => true,
      execute: (_args, exec) => run(async () => {
        const list = await request('GET', '/api/containers', { signal: exec.signal })
        const containers = list.map(entry => containerRow(entry, selfId))
        const payload = { ok: true, containers }
        if (selfId !== null) payload.selfContainerId = selfId
        return payload
      }),
    }),

    defineTool({
      name: 'dshdock_container_create',
      description: 'Create a DSH Dock container (background task; ~8s on a prebuilt version, ~70s on the first build of a version). Returns the container id; wait=true blocks until creation finishes.',
      parameters: {
        name: { type: 'string', required: true, description: '容器名:字母/数字/点/下划线/连字符,全局唯一。' },
        version: { type: 'string', required: true, description: 'DSH 版本 tag(须已安装,见 dshdock_versions)。' },
        profile: { type: 'string', enum: ['web', 'headless'], description: 'profile 档位,默认 web(web 带 UI,headless 无网页)。' },
        wait: WAIT_PARAM,
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...RESULT_BASE,
            containerId: { type: 'string' },
            status: { type: 'string', enum: ['submitted', 'succeeded', 'failed', 'running'] },
            taskId: { type: 'string' },
            lines: { type: 'array', items: { type: 'string' } },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      timeoutMs: 180000,
      execute: (args, exec) => run(async () => {
        const submitted = await request('POST', '/api/containers', {
          body: { name: args.name, version: args.version, profile: args.profile ?? 'web' },
          signal: exec.signal,
        })
        const containerId = submitted.id
        if (args.wait === false) return clean({ ok: true, containerId, status: 'submitted', taskId: undefined, hint: '创建任务已提交;用 dshdock_tasks { refId } 跟踪。' })
        return finishWaitable(request, 'container-create', containerId, 180000, { ok: true, containerId }, exec.signal)
      }),
    }),

    defineTool({
      name: 'dshdock_container_lifecycle',
      description: 'Start / stop / update a DSH Dock container (three actions in one tool). Self protection: stopping or updating the container this session lives in is refused unless force=true.',
      parameters: {
        container: { type: 'string', required: true, description: '容器 id 或名称。' },
        action: { type: 'string', enum: ['start', 'stop', 'update'], required: true, description: 'start=启动并就绪探测;stop=优雅停止;update=更换版本(须传入 version)。' },
        version: { type: 'string', description: 'update 的目标版本 tag(须已安装)。' },
        wait: WAIT_PARAM,
        force: { type: 'boolean', description: '对 self 容器执行 stop/update 时必须显式为 true(会杀死当前会话)。' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...RESULT_BASE,
            containerId: { type: 'string' },
            action: { type: 'string', enum: ['start', 'stop', 'update'] },
            status: { type: 'string', enum: ['succeeded', 'failed', 'running', 'submitted'] },
            taskId: { type: 'string' },
            lines: { type: 'array', items: { type: 'string' } },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      timeoutMs: 180000,
      execute: (args, exec) => run(async () => {
        const target = await resolveContainer(request, args.container)
        assertNotSelfMutation(target, args.action, args.force, selfId)
        if (args.action === 'stop') {
          await request('POST', `/api/containers/${target.id}/stop`, { timeoutMs: 30000, signal: exec.signal })
          return clean({ ok: true, containerId: target.id, action: 'stop', status: 'succeeded' })
        }
        if (args.action === 'update') {
          if (typeof args.version !== 'string') {
            throw new DockError('update 需要显式 version 参数', { code: 'bad-request', hint: '用 dshdock_versions 查看已安装版本后传入 tag。' })
          }
          await request('POST', `/api/containers/${target.id}/update`, { body: { version: args.version }, signal: exec.signal })
          if (args.wait === false) return clean({ ok: true, containerId: target.id, action: 'update', status: 'submitted', hint: '更新任务已提交;用 dshdock_tasks { refId } 跟踪。' })
          return finishWaitable(request, 'container-update', target.id, 180000, { ok: true, containerId: target.id, action: 'update' }, exec.signal)
        }
        await request('POST', `/api/containers/${target.id}/start`, { signal: exec.signal })
        if (args.wait === false) return clean({ ok: true, containerId: target.id, action: 'start', status: 'submitted', hint: '启动任务已提交;用 dshdock_tasks { refId } 跟踪。' })
        return finishWaitable(request, 'container-start', target.id, 150000, { ok: true, containerId: target.id, action: 'start' }, exec.signal)
      }),
    }),

    defineTool({
      name: 'dshdock_container_delete',
      description: 'Delete a DSH Dock container and its whole directory (profile and sessions included). Requires confirm=true; refuses the self container unless force=true; devProtect deletion additionally requires explicit confirmation, which confirm satisfies.',
      parameters: {
        container: { type: 'string', required: true, description: '容器 id 或名称。' },
        confirm: { type: 'boolean', required: true, description: '必须显式为 true:删除不可恢复(整个容器目录被移除)。' },
        force: { type: 'boolean', description: '对 self 容器删除时必须显式为 true(会杀死当前会话)。' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { ...RESULT_BASE, containerId: { type: 'string' } },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      timeoutMs: 120000,
      execute: (args, exec) => run(async () => {
        if (args.confirm !== true) {
          throw new DockError('删除需要显式确认', { code: 'need-confirm', hint: '请将 confirm 设为 true 并向用户复述删除后果后再执行。' })
        }
        const target = await resolveContainer(request, args.container)
        assertNotSelfMutation(target, '删除', args.force, selfId)
        await request('DELETE', `/api/containers/${target.id}`, { body: { confirmDevProtect: true }, timeoutMs: 60000, signal: exec.signal })
        return clean({ ok: true, containerId: target.id })
      }),
    }),

    defineTool({
      name: 'dshdock_container_url',
      description: 'Get the tokenized web URL of a running DSH Dock container (the URL opens straight into its DSH web UI).',
      parameters: {
        container: { type: 'string', required: true, description: '容器 id 或名称。' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { ...RESULT_BASE, containerId: { type: 'string' }, url: { type: 'string' } },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      isConcurrencySafe: () => true,
      timeoutMs: 15000,
      execute: (args, exec) => run(async () => {
        const target = await resolveContainer(request, args.container)
        const answer = await request('GET', `/api/containers/${target.id}/url`, { signal: exec.signal })
        return clean({ ok: true, containerId: target.id, url: answer.url })
      }),
    }),

    defineTool({
      name: 'dshdock_container_log',
      description: 'Read the tail of a container host.log for troubleshooting (default last 80 lines, at most 400).',
      parameters: {
        container: { type: 'string', required: true, description: '容器 id 或名称。' },
        tail: { type: 'integer', description: '返回的末尾行数,默认 80,上限 400。' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { ...RESULT_BASE, containerId: { type: 'string' }, text: { type: 'string' } },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      isConcurrencySafe: () => true,
      timeoutMs: 15000,
      execute: (args, exec) => run(async () => {
        const target = await resolveContainer(request, args.container)
        const answer = await request('GET', `/api/containers/${target.id}/hostlog`, { signal: exec.signal })
        const text = typeof answer?.text === 'string' ? answer.text : ''
        const limit = Math.min(Math.max(1, args.tail ?? 80), 400)
        const lines = text.length === 0 ? [] : text.split('\n')
        const body = lines.length === 0 ? '(尚无日志)' : lines.slice(-limit).join('\n')
        return clean({ ok: true, containerId: target.id, text: body })
      }),
    }),

    defineTool({
      name: 'dshdock_versions',
      description: 'List the DSH version catalog: remote tags plus which are installed locally. refresh=true refetches the remote catalog from GitHub.',
      parameters: {
        refresh: { type: 'boolean', description: '强制刷新远端版本目录(默认使用缓存)。' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...RESULT_BASE,
            fetchedAt: { type: 'integer' },
            warning: { type: 'string' },
            versions: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  tag: { type: 'string', required: true },
                  installed: { type: 'boolean', required: true },
                },
              },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      isConcurrencySafe: () => true,
      timeoutMs: 45000,
      execute: (args, exec) => run(async () => {
        const answer = await request('GET', `/api/versions/catalog${args.refresh === true ? '?refresh=1' : ''}`, { timeoutMs: 40000, signal: exec.signal })
        const installed = new Set(Array.isArray(answer.installed) ? answer.installed : [])
        // The service returns tags as `{ name, sha }` objects (or plain
        // strings from another source); normalize both.
        const tagName = entry => typeof entry === 'string' ? entry : (entry !== null && typeof entry === 'object' && typeof entry.name === 'string' ? entry.name : '')
        const versions = (Array.isArray(answer.tags) ? answer.tags : [])
          .map(entry => {
            const tag = tagName(entry)
            return { tag, installed: installed.has(tag) }
          })
          .filter(entry => entry.tag.length > 0)
        const payload = { ok: true, versions }
        if (typeof answer.fetchedAt === 'number') payload.fetchedAt = answer.fetchedAt
        if (typeof answer.warning === 'string') payload.warning = answer.warning
        return payload
      }),
    }),

    defineTool({
      name: 'dshdock_version_install',
      description: 'Install a DSH version (git clone + dependency prewarm; the slowest operation, command-level cap ~10min). wait=true blocks until it finishes.',
      parameters: {
        tag: { type: 'string', required: true, description: '要安装的版本 tag(来自 dshdock_versions)。' },
        wait: WAIT_PARAM,
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...RESULT_BASE,
            tag: { type: 'string' },
            status: { type: 'string', enum: ['submitted', 'succeeded', 'failed', 'running'] },
            taskId: { type: 'string' },
            lines: { type: 'array', items: { type: 'string' } },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      timeoutMs: 660000,
      execute: (args, exec) => run(async () => {
        await request('POST', '/api/versions/install', { body: { tag: args.tag }, signal: exec.signal })
        if (args.wait === false) return clean({ ok: true, tag: args.tag, status: 'submitted', hint: '安装任务已提交;用 dshdock_tasks { refId } 跟踪。' })
        return finishWaitable(request, 'version-install', args.tag, 660000, { ok: true, tag: args.tag }, exec.signal)
      }),
    }),

    defineTool({
      name: 'dshdock_tasks',
      description: 'Inspect DSH Dock background tasks (create/start/update/install). Optional refId filter; the fallback observation window for wait=false submissions.',
      parameters: {
        refId: { type: 'string', description: '按容器 id 或版本 tag 过滤。' },
        lines: { type: 'integer', description: '每条任务附带的末尾日志行数,默认 10,上限 100。' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { ...RESULT_BASE, tasks: { type: 'array', items: TASK_ROW } },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      isConcurrencySafe: () => true,
      timeoutMs: 15000,
      execute: (args, exec) => run(async () => {
        const list = await request('GET', '/api/tasks', { signal: exec.signal })
        const maxLines = Math.min(Math.max(1, args.lines ?? 10), 100)
        const filtered = typeof args.refId === 'string'
          ? list.filter(entry => entry.refId === args.refId)
          : list
        return {
          ok: true,
          tasks: filtered.map(entry => taskRow(entry, maxLines)),
        }
      }),
    }),
  ]

  return tools
}
