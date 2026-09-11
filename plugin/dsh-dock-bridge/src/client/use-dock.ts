/**
 * Data hook behind the "DSH Dock" section. One cohesive view state for the
 * three cards: environment status, containers, versions,
 * service settings, and the watched background tasks. Mutations go through
 * the `/dshdock-plugins` channel; long tasks are followed by 1s polling of
 * the service task list (the same kind+refId semantics the tools use), and
 * a settled task refreshes the affected lists.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ContainerRow, DockSettings, DockStatus, DockTask, ModelConfigView, OpError, ProfileTemplate, RawVersionCatalog, RestAnswer, VersionCatalog,
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
 * Per-container record of the user's protect choice (browser-local): the
 * automatic default-enable fires at most once, then manual choice wins.
 */
function protectChoiceKey(id: string): string {
  return `dshdock-autoprotect:${id}`
}

/** Whether this browser already settled the protect default for one container. */
function hasProtectChoice(id: string): boolean {
  try {
    return window.localStorage.getItem(protectChoiceKey(id)) !== null
  } catch {
    return true
  }
}

/** Record the protect choice: called by the auto-enable and by the manual checkbox. */
export function markProtectChoice(id: string): void {
  try {
    window.localStorage.setItem(protectChoiceKey(id), '1')
  } catch {
    // Private mode and the like: without storage the default stays one-shot
    // per session via the attempted ref instead.
  }
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
  const [settings, setSettings] = useState<DockSettings>()
  const [settingsError, setSettingsError] = useState<OpError>()
  const [template, setTemplate] = useState<ProfileTemplate>()
  const [templateError, setTemplateError] = useState<OpError>()
  const [modelConfig, setModelConfig] = useState<ModelConfigView>()
  const [modelConfigError, setModelConfigError] = useState<OpError>()
  const [tasks, setTasks] = useState<readonly DockTask[]>([])
  const [busyOps, setBusyOps] = useState<ReadonlySet<string>>(() => new Set())
  const [opError, setOpError] = useState<OpError & { key: string }>()
  const [watching, setWatching] = useState<readonly Watch[]>([])
  const callRef = useRef(call)
  callRef.current = call
  const statusRef = useRef<DockStatus>()
  statusRef.current = status

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
      const rows = await rest<readonly ContainerRow[]>('GET', '/api/containers', undefined, '容器列表加载失败')
      // The service rows carry no self marker (tools stamp it server-side);
      // the page stamps it from the probed self container id instead.
      const selfId = statusRef.current?.selfContainerId
      setContainers(rows.map(row => ({ ...row, self: selfId !== undefined && row.id === selfId })))
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
      const seen = new Set<string>()
      const versions = (raw.tags ?? []).map((entry) => {
        const tag = typeof entry === 'string' ? entry : entry?.name ?? ''
        seen.add(tag)
        return { tag, installed: installed.has(tag), remote: true }
      }).filter(entry => entry.tag.length > 0)
      // Installed versions missing from the remote catalog render as extra
      // rows (same as the WebUI `extraInstalled` rows).
      for (const name of installed) {
        if (!seen.has(name)) versions.push({ tag: name, installed: true, remote: false })
      }
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

  const refreshTemplate = useCallback(async () => {
    setTemplateError(undefined)
    try {
      setTemplate(await rest<ProfileTemplate>('GET', '/api/profile-template', undefined, '配置模板加载失败'))
    } catch (error) {
      setTemplateError(asOpError(error))
    }
  }, [rest])

  const refreshModelConfig = useCallback(async () => {
    setModelConfigError(undefined)
    try {
      setModelConfig(await rest<ModelConfigView>('GET', '/api/model-configs', undefined, '模型配置加载失败'))
    } catch (error) {
      setModelConfigError(asOpError(error))
    }
  }, [rest])


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

  // Initial load: status first; service-dependent lists load when reachable.
  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])
  useEffect(() => {
    if (!serviceUp) {
      setContainers([])
      setVersions(undefined)
      setSettings(undefined)
      setTemplate(undefined)
      setModelConfig(undefined)
      return
    }
    void refreshContainers()
    void refreshVersions()
    void refreshSettings()
    void refreshTemplate()
    void refreshModelConfig()
  }, [serviceUp, refreshContainers, refreshVersions, refreshSettings, refreshTemplate, refreshModelConfig])

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

  // A container running this plugin is a dev container by definition: default
  // the self row to devProtect, at most once per container. A manual choice
  // (recorded by markProtectChoice, including the checkbox below) wins
  // permanently; a failure surfaces through the shared op error instead of
  // retry-looping.
  const protectAttempted = useRef<string>()
  useEffect(() => {
    if (!serviceUp) return
    const selfRow = containers.find(row => row.self)
    if (selfRow === undefined || selfRow.devProtect === true) return
    if (protectAttempted.current === selfRow.id) return
    protectAttempted.current = selfRow.id
    if (hasProtectChoice(selfRow.id)) return
    markProtectChoice(selfRow.id)
    void setProtect(selfRow.id, true)
  }, [serviceUp, containers, setProtect])

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

  const saveModel = useCallback(async (targetUid: string, model: Readonly<Record<string, unknown>>, apiKey: string) => {
    try {
      const body = apiKey === '' ? { model } : { model, apiKey }
      await mutate('modelConfig', () => rest('PUT', `/api/model-configs/models/${encodeURIComponent(targetUid)}`, body, '模型保存失败'))
      void refreshModelConfig()
      return true
    } catch {
      return false
    }
  }, [mutate, rest, refreshModelConfig])

  const deleteModel = useCallback(async (uid: string) => {
    try {
      await mutate('modelConfig', () => rest('DELETE', `/api/model-configs/models/${encodeURIComponent(uid)}`, undefined, '模型删除失败'))
      void refreshModelConfig()
      return true
    } catch {
      return false
    }
  }, [mutate, rest, refreshModelConfig])

  const setDefaultModel = useCallback(async (uid: string) => {
    try {
      await mutate('modelConfig', () => rest('POST', '/api/model-configs/default', { uid }, '默认模型保存失败'))
      void refreshModelConfig()
      return true
    } catch {
      return false
    }
  }, [mutate, rest, refreshModelConfig])

  const importModelConfig = useCallback(async (containerId: string) => {
    try {
      await mutate('modelConfig', () => rest('POST', '/api/model-configs/import', { containerId }, '模型配置导入失败'))
      void refreshModelConfig()
      return true
    } catch {
      return false
    }
  }, [mutate, rest, refreshModelConfig])

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
    settings,
    settingsError,
    template,
    templateError,
    modelConfig,
    modelConfigError,
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
    refreshTemplate,
    refreshModelConfig,
    saveModel,
    deleteModel,
    setDefaultModel,
    importModelConfig,
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
  readonly settings: DockSettings | undefined
  readonly settingsError: OpError | undefined
  readonly template: ProfileTemplate | undefined
  readonly templateError: OpError | undefined
  readonly modelConfig: ModelConfigView | undefined
  readonly modelConfigError: OpError | undefined
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
  refreshTemplate: () => Promise<void>
  refreshModelConfig: () => Promise<void>
  saveModel: (targetUid: string, model: Readonly<Record<string, unknown>>, apiKey: string) => Promise<boolean>
  deleteModel: (uid: string) => Promise<boolean>
  setDefaultModel: (uid: string) => Promise<boolean>
  importModelConfig: (containerId: string) => Promise<boolean>
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
  setBaseUrl: (next: string) => Promise<boolean>
  taskFor: (kind: string, refId: string) => DockTask | undefined
  pending: (kind: string, refId: string) => boolean
  isBusy: (key: string) => boolean
}
