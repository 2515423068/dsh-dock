/**
 * Long-task waiting for the dshdock_* tools. DSH Dock runs create/start/
 * update/install as background tasks observable at `GET /api/tasks`; model
 * tools are request-response, so `wait=true` polls that list (1s interval,
 * kind+refId match) until the task settles. On tool-timeout exhaustion the
 * poller returns the still-running task with its recent lines so the model
 * can decide to keep waiting (`dshdock_tasks`) or give up.
 */

const POLL_INTERVAL_MS = 1000
/** Margin kept between the poll deadline and the harness tool timeout. */
const TOOL_TIMEOUT_MARGIN_MS = 15000

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    if (signal !== undefined) {
      const onAbort = () => {
        clearTimeout(timer)
        reject(new Error('调用已取消'))
      }
      if (signal.aborted) {
        clearTimeout(timer)
        reject(new Error('调用已取消'))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

/** Take the last `count` lines of a task log. */
export function tailLines(lines, count) {
  const list = Array.isArray(lines) ? lines : []
  return list.slice(-Math.max(1, count))
}

/**
 * Poll `GET /api/tasks` for one task until it settles or the budget ends.
 * @param request - shared HTTP client request function.
 * @param kind - task kind to match (`container-create`, `container-start`,
 *   `container-update`, `version-install`).
 * @param refId - task ref id (container id or version tag).
 * @param options - total wait budget, caller signal, poll interval.
 * @returns `{ task, timedOut }`; `task` is the matched record (status
 *   `succeeded`/`failed` when settled) or `undefined` when none was seen.
 */
export async function waitTask(request, kind, refId, { timeoutMs, signal, intervalMs = POLL_INTERVAL_MS } = {}) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const tasks = await request('GET', '/api/tasks')
    const task = tasks.find(entry => entry.kind === kind && entry.refId === refId)
    if (task !== undefined && task.status !== 'running') {
      return { task, timedOut: false }
    }
    if (Date.now() >= deadline) {
      return { task, timedOut: true }
    }
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())), signal)
  }
}

/** Tool budget minus the final-request margin, floored at 5s. */
export function pollBudget(toolTimeoutMs) {
  return Math.max(5000, toolTimeoutMs - TOOL_TIMEOUT_MARGIN_MS)
}
