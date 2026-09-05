/**
 * Environment detection for the dsh-dock-bridge plugin.
 *
 * Three-level probe (design §3.4): 1) is this DSH instance a container
 * created by DSH Dock (DSH_HOME realpath matches `<DATA_ROOT>/containers/<id>/profile`
 * and that container's `container.json` exists); 2) is the DSH Dock service
 * reachable at the resolved baseUrl; 3) when both fail, this is an
 * independent DSH. The self detection result is stable for the process
 * lifetime (DSH_HOME never changes mid-process) and therefore cached;
 * reachability is probed live on every request, never cached as a verdict.
 */
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'

/** Stable facts about the self container, when this DSH runs under DSH Dock. */
let selfFacts

/**
 * Detect the self container from DSH_HOME. Computed once and cached.
 * @returns `{ containersDir, selfId }`, or `null` when this is an independent DSH.
 */
export function detectSelf() {
  if (selfFacts !== undefined) return selfFacts
  selfFacts = computeSelf()
  return selfFacts
}

function computeSelf() {
  const home = process.env.DSH_HOME
  if (typeof home !== 'string' || home.length === 0) return null
  let real
  try {
    real = realpathSync(home)
  } catch {
    return null
  }
  const match = real.match(/^(.*)[/\\]containers[/\\]([^/\\]+)[/\\]profile$/)
  if (!match) return null
  const containersDir = match[1] + path.sep + 'containers'
  const selfId = match[2]
  if (!existsSync(path.join(containersDir, selfId, 'container.json'))) return null
  return { containersDir, selfId }
}

/**
 * Probe the DSH Dock service with a cheap settings read.
 * @param request - the shared HTTP client's request function.
 * @returns true when the service answered (any status below 500 with a JSON
 *   body counts; the onboarding 409 gate still proves the service is up).
 */
export async function probeService(request) {
  try {
    await request('GET', '/api/settings', { timeoutMs: 4000 })
    return true
  } catch (error) {
    // A 409 onboarding gate answer still proves the service is running.
    if (error && error.status === 409) return true
    return false
  }
}
