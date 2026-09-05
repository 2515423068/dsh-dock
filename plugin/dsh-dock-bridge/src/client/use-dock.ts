/**
 * Data hook behind the "DSH Dock" section. One cohesive view state for the
 * four cards: environment status, containers, versions, profile plugins,
 * service settings, and the watched background tasks. Mutations go through
 * the `/dshdock-plugins` channel; long tasks are followed by 1s polling of
 * the service task list (the same kind+refId semantics the tools use), and
 * a settled task refreshes the affected lists.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ContainerRow, DockSettings, DockStatus, DockTask, OpError, PluginList, PluginOpAnswer, RawVersionCatalog, RestAnswer, VersionCatalog,
} from './api.ts'

/** RPC face injected into the section (closed over the client ctx). */
export type DockCall = <T>(endpoint: string, payload?: unknown) => Promise<T>

const POLL_INTERVAL_MS = 1000

/** One watched long task (kind+refId pair, tool semantics). */
interface Watch {
  kind: string
  refId: string
}

/** Extract an OpError from a dock.rest answer (transport failures included). */
function toOpError(answer: RestAnswer, fallbackTitle: string): OpError {
  const body = answer.body
  const message = (body !== null && typeof body === 'object' && typeof (body as Record<string, unknown>).error === 'string')
    ? (body as Record<string, unknown>).error as string
    : `HTTP ${answer.status}`
  const hint = (body !== null && typeof body === 'object' && typeof (body as Record<string, unknown>).hint === 'string')
    ? (body as Record<string, unknown>).hint as string
    : undefined
  return { title: `${fallbackTitle}: ${message}`, detail: hint }
}

/** Coerce any thrown value into an OpError (REST failures are plain OpErrors). */
function asOpError(error: unknown): OpError {
  if (typeof error === 'object' && error !== null && typeof (error as OpError).title === 'string') {
    return error as OpError
  }
  return { title: error instanceof Error ? error.message : String(error) }
}

/**
 * The section's whole data/operation surface.
 * @param call - channel caller provided by the plugin apply closure.
 */
export function useDock(call: DockCall): DockStore {
  const [status, setStatus] = useState<DockStatus>()
  const [statusError, setStatusError] = useState<string>()
  const [containers, setContainers] = useState<readonly ContainerRow[]>([])
  const [containersError, setContainersError] = useState<OpError>()
  const [versions, setVersions] = useState<VersionCatalog>()
  const [versionsError, setVersionsError] = useState<OpError>()
  const [plugins, setPlugins] = useState<PluginList>()
  const [pluginsError, setPluginsError] = useState<OpError>()
  const [settings, setSettings] = useState<DockSettings>()
  const [settingsError, setSettingsError] = useState<OpError>()
  const [tasks, setTasks] = useState<readonly DockTask[]>([])
  const [busyOps, setBusyOps] = useState<ReadonlySet<string>>(() => new Set())
  const [opError, setOpError] = useState<OpError & { key: string }>()
  const [watching, setWatching] = useState<readonly Watch[]>([])
  const callRef = useRef(call)
  callRef.current = call

  const serviceUp = status?.serviceReachable === true

  const markBusy = useCallback((key: string, busy: boolean) => {
    setBusyOps(previous => {
      const next = new Set(previous)
      if (busy) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  /** One allowlisted REST call; non-2xx answers become thrown OpErrors. */
  const rest = useCallback(async <T,>(method: string, path: string, body?: unknown, failTitle = '操作失败'): Promise<T> => {
    const answer = await callRef.current<RestAnswer<T>>('dock.rest', { method, path, body })
    if (answer.status === 0) throw toOpError(answer, failTitle)
    if (answer.status >= 400) throw toOpError(answer, failTitle)
    return answer.body
  }, [])

  const refreshStatus = useCallback(async () => {
    setStatusError(undefined)
    try {
      setStatus(await callRef.current<DockStatus>('dock.status'))
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const refreshContainers = useCallback(async () => {
    setContainersError(undefined)
    try {
      setContainers(await rest<readonly ContainerRow[]>('GET', '/api/containers', undefined, '容器列表加载失败'))
    } catch (error) {
      setContainersError(asOpError(error))
    }
  }, [rest])

  const refreshVersions = useCallback(async (refreshCatalog = false) => {
    setVersionsError(undefined)
    if (refreshCatalog) markBusy('versionsRefresh', true)
    try {
      const raw = await rest<RawVersionCatalog>('GET', `/api/versions/catalog${refreshCatalog ? '?refresh=1' : ''}`, undefined, '版本目录加载失败')
      const installed = new Set(raw.installed ?? [])
      const versions = (raw.tags ?? []).map((entry) => {
        const tag = typeof entry === 'string' ? entry : entry?.name ?? ''
        return { tag, installed: installed.has(tag) }
      }).filter(entry => entry.tag.length > 0)
      setVersions({ fetchedAt: raw.fetchedAt, warning: raw.warning, versions })
    } catch (error) {
      setVersionsError(asOpError(error))
    } finally {
      if (refreshCatalog) markBusy('versionsRefresh', false)
    }
  }, [rest, markBusy])

  const refreshSettings = useCallback(async () => {
    setSettingsError(undefined)
    try {
      setSettings(await rest<DockSettings>('GET', '/api/settings', undefined, '设置加载失败'))
    } catch (error) {
      setSettingsError(asOpError(error))
    }
  }, [rest])

  const refreshPlugins = useCallback(async () => {
    setPluginsError(undefined)
    try {
      setPlugins(await callRef.current<PluginList>('list'))
    } catch (error) {
      setPluginsError(asOpError(error))
    }
  }, [])

  const refreshTasks = useCallback(async () => {
    try {
      setTasks(await rest<readonly DockTask[]>('GET', '/api/tasks', undefined, '任务列表加载失败'))
    } catch {
      // The task list is best-effort; progress polling simply stalls.
    }
  }, [rest])

  /** Follow one submitted task until it settles, then refresh the lists. */
  const watch = useCallback((kind: string, refId: string) => {
    setWatching(previous => previous.some(entry => entry.kind === kind && entry.refId === refId) ? previous : [...previous, { kind, refId }])
  }, [])

  // Poll while something is watched; a settled task un-watches and refreshes.
  useEffect(() => {
    if (watching.length === 0) return
    let disposed = false
    const tick = async (): Promise<void> => {
      if (disposed) return
      try {
        const list = await rest<readonly DockTask[]>('GET', '/api/tasks', undefined, '任务轮询失败')
        if (disposed) return
        setTasks(list)
        const settled = watching.filter(({ kind, refId }) => {
          const task = list.find(entry => entry.kind === kind && entry.refId === refId)
          return task !== undefined && task.status !== 'running'
        })
        if (settled.length > 0) {
          setWatching(previous => previous.filter(entry => !settled.some(settledEntry => settledEntry.kind === entry.kind && settledEntry.refId === entry.refId)))
          void refreshContainers()
          void refreshVersions()
        }
      } catch {
        // Keep polling; a transient transport failure must not kill the loop.
      }
    }
    const timer = window.setInterval(() => { void tick() }, POLL_INTERVAL_MS)
    void tick()
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [watching, rest, refreshContainers, refreshVersions])

  // Initial load: status first; service-dependent lists only when reachable,
  // plugins always (they need no service).
  useEffect(() => {
    void refreshStatus()
    void refreshPlugins()
  }, [refreshStatus, refreshPlugins])
  useEffect(() => {
    if (!serviceUp) {
      setContainers([])
      setVersions(undefined)
      setSettings(undefined)
      return
    }
    void refreshContainers()
    void refreshVersions()
    void refreshSettings()
  }, [serviceUp, refreshContainers, refreshVersions, refreshSettings])

  const taskFor = useCallback((kind: string, refId: string): DockTask | undefined =>
    tasks.find(entry => entry.kind === kind && entry.refId === refId), [tasks])

  const pending = useCallback((kind: string, refId: string): boolean => {
    const task = taskFor(kind, refId)
    return task !== undefined && task.status === 'running'
  }, [taskFor])

  /** Run one mutation with a busy key; the failure is scoped to that key. */
  const mutate = useCallback(async <T,>(key: string, work: () => Promise<T>): Promise<T> => {
    markBusy(key, true)
    setOpError(undefined)
    try {
      return await work()
    } catch (error) {
      setOpError({ ...asOpError(error), key })
      throw error
    } finally {
      markBusy(key, false)
    }
  }, [markBusy])

  const createContainer = useCallback(async (input: { name: string; version: string; profile: string }) => {
    const answer = await mutate('create', async () =>
      rest<{ id: string }>('POST', '/api/containers', input, '创建失败'))
    watch('container-create', answer.id)
  }, [mutate, rest, watch])

  const startContainer = useCallback(async (id: string, force = false) => {
    await mutate(`start:${id}`, () => rest('POST', `/api/containers/${id}/start`, force ? { force } : undefined, '启动失败'))
    watch('container-start', id)
  }, [mutate, rest, watch])

  const stopContainer = useCallback(async (id: string, force = false) => {
    await mutate(`stop:${id}`, () => rest('POST', `/api/containers/${id}/stop`, force ? { force } : undefined, '停止失败'))
    void refreshContainers()
  }, [mutate, rest, refreshContainers])

  const updateContainer = useCallback(async (id: string, version: string, force = false) => {
    await mutate(`update:${id}`, () => rest('POST', `/api/containers/${id}/update`, { version, ...(force ? { force } : {}) }, '更新失败'))
    watch('container-update', id)
  }, [mutate, rest, watch])

  const deleteContainer = useCallback(async (id: string, force = false) => {
    await mutate(`delete:${id}`, () => rest('DELETE', `/api/containers/${id}`, { confirmDevProtect: true, ...(force ? { force } : {}) }, '删除失败'))
    void refreshContainers()
  }, [mutate, rest, refreshContainers])

  const setPort = useCallback(async (id: string, port: number) => {
    try {
      await mutate(`port:${id}`, () => rest('POST', `/api/containers/${id}/port`, { port }, '改端口失败'))
      return true
    } catch {
      return false
    }
  }, [mutate, rest])

  const setProtect = useCallback(async (id: string, enabled: boolean) => {
    try {
      await mutate(`protect:${id}`, () => rest('POST', `/api/containers/${id}/protect`, { enabled }, '保护开关失败'))
      void refreshContainers()
      return true
    } catch {
      return false
    }
  }, [mutate, rest, refreshContainers])

  const installVersion = useCallback(async (tag: string) => {
    await mutate(`install:${tag}`, () => rest('POST', '/api/versions/install', { tag }, '安装失败'))
    watch('version-install', tag)
  }, [mutate, rest, watch])

  const deleteVersion = useCallback(async (tag: string) => {
    await mutate(`versionDelete:${tag}`, () => rest('DELETE', `/api/versions/${encodeURIComponent(tag)}`, undefined, '删除版本失败'))
    void refreshVersions()
  }, [mutate, rest, refreshVersions])

  const saveSettings = useCallback(async (next: DockSettings) => {
    try {
      await mutate('settings', () => rest('POST', '/api/settings', next, '保存设置失败'))
      void refreshSettings()
      return true
    } catch {
      return false
    }
  }, [mutate, rest, refreshSettings])

  /** Plugin operations return the channel answer (never throw for op failures). */
  const pluginOp = useCallback(async (endpoint: string, payload: unknown): Promise<PluginOpAnswer> => {
    setPluginsError(undefined)
    try {
      return await callRef.current<PluginOpAnswer>(endpoint, payload)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }, [])

  const installPlugin = useCallback(async (spec: string) => {
    const answer = await pluginOp('install', { spec })
    if (answer.plugins !== undefined) setPlugins({ ok: answer.ok, plugins: answer.plugins, recognized: true })
    return answer
  }, [pluginOp])

  const uninstallPlugin = useCallback(async (name: string) => {
    const answer = await pluginOp('uninstall', { name })
    if (answer.plugins !== undefined) setPlugins({ ok: answer.ok, plugins: answer.plugins, recognized: true })
    return answer
  }, [pluginOp])

  const setPluginEnabled = useCallback(async (name: string, enabled: boolean) => {
    const answer = await pluginOp(enabled ? 'enable' : 'disable', { name })
    if (answer.plugins !== undefined) setPlugins({ ok: answer.ok, plugins: answer.plugins, recognized: true })
    return answer
  }, [pluginOp])

  const setBaseUrl = useCallback(async (next: string) => {
    try {
      await mutate('baseUrl', () => callRef.current('dock.baseUrl', { baseUrl: next }))
      await refreshStatus()
      return true
    } catch {
      return false
    }
  }, [mutate, refreshStatus])

  return {
    status,
    statusError,
    containers,
    containersError,
    versions,
    versionsError,
    plugins,
    pluginsError,
    settings,
    settingsError,
    serviceUp,
    bound: status?.dshdockContainer === true,
    tasks,
    watching,
    clearOpError: () => { setOpError(undefined) },
    opErrorFor: (prefixes: readonly string[]) =>
      opError !== undefined && prefixes.some(prefix => opError.key === prefix || opError.key.startsWith(prefix))
        ? opError
        : undefined,
    refreshStatus,
    refreshContainers,
    refreshVersions,
    refreshSettings,
    refreshPlugins,
    createContainer,
    startContainer,
    stopContainer,
    updateContainer,
    deleteContainer,
    setPort,
    setProtect,
    installVersion,
    deleteVersion,
    saveSettings,
    installPlugin,
    uninstallPlugin,
    setPluginEnabled,
    setBaseUrl,
    taskFor,
    pending,
    isBusy: (key: string) => busyOps.has(key),
  }
}

/** The section's data/operation surface handed to the four cards. */
export interface DockStore {
  readonly status: DockStatus | undefined
  readonly statusError: string | undefined
  readonly containers: readonly ContainerRow[]
  readonly containersError: OpError | undefined
  readonly versions: VersionCatalog | undefined
  readonly versionsError: OpError | undefined
  readonly plugins: PluginList | undefined
  readonly pluginsError: OpError | undefined
  readonly settings: DockSettings | undefined
  readonly settingsError: OpError | undefined
  readonly serviceUp: boolean
  readonly bound: boolean
  readonly tasks: readonly DockTask[]
  readonly watching: readonly Watch[]
  clearOpError: () => void
  /** The latest mutation failure whose busy key matches one of the prefixes. */
  opErrorFor: (prefixes: readonly string[]) => OpError | undefined
  refreshStatus: () => Promise<void>
  refreshContainers: () => Promise<void>
  refreshVersions: (refreshCatalog?: boolean) => Promise<void>
  refreshSettings: () => Promise<void>
  refreshPlugins: () => Promise<void>
  createContainer: (input: { name: string; version: string; profile: string }) => Promise<void>
  startContainer: (id: string, force?: boolean) => Promise<void>
  stopContainer: (id: string, force?: boolean) => Promise<void>
  updateContainer: (id: string, version: string, force?: boolean) => Promise<void>
  deleteContainer: (id: string, force?: boolean) => Promise<void>
  setPort: (id: string, port: number) => Promise<boolean>
  setProtect: (id: string, enabled: boolean) => Promise<boolean>
  installVersion: (tag: string) => Promise<void>
  deleteVersion: (tag: string) => Promise<void>
  saveSettings: (next: DockSettings) => Promise<boolean>
  installPlugin: (spec: string) => Promise<PluginOpAnswer>
  uninstallPlugin: (name: string) => Promise<PluginOpAnswer>
  setPluginEnabled: (name: string, enabled: boolean) => Promise<PluginOpAnswer>
  setBaseUrl: (next: string) => Promise<boolean>
  taskFor: (kind: string, refId: string) => DockTask | undefined
  pending: (kind: string, refId: string) => boolean
  isBusy: (key: string) => boolean
}
