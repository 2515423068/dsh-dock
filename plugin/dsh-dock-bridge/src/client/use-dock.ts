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
  ConfigCatalog, ConfigImported, ConfigInspect, ConfigInspectItem, ConfigSaved, ContainerRow,
  DockSettings, DockStatus, DockTask, ExternalCheck, ExternalView, FsListing, FsListMode, ModelConfigView, OpError,
  ProfileTemplate, RawVersionCatalog, RestAnswer, VersionCatalog,
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

/** Which picker a browse belongs to; both controls share the one in-page picker. */
export type PathPickerMode = FsListMode

/** One `GET /api/fs/list` attempt: the listing, or the last failure when none listed. */
export interface FsBrowse {
  readonly listing?: FsListing
  /** True when the requested path was missing and the nearest ancestor listed instead. */
  readonly fellBack: boolean
  readonly failure?: OpError
}

/** Last directory the picker visited for one mode (browser-local; '' = home). */
function readPickerPath(mode: PathPickerMode): string {
  try {
    return window.localStorage.getItem(`dshdock-picker-${mode}`) ?? ''
  } catch {
    return ''
  }
}

/** Remember the picker's last visited directory for one mode. */
function writePickerPath(mode: PathPickerMode, path: string): void {
  try {
    window.localStorage.setItem(`dshdock-picker-${mode}`, path)
  } catch {
    // Private mode and the like: the picker simply opens at home next time.
  }
}

/**
 * The requested path first, then its ancestors: a starting path may not exist
 * yet (a configuration directory before it is created), and the picker opens
 * at the nearest directory that does.
 */
function ancestorCandidates(target: string): string[] {
  const candidates = [target]
  let cursor = target
  for (let index = 0; index < 12; index += 1) {
    const parent = cursor.replace(/[\\/][^\\/]*$/, '')
    if (parent === cursor || parent.length === 0) break
    cursor = parent
    candidates.push(parent)
  }
  return candidates
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
  const [external, setExternal] = useState<ExternalView>()
  const [externalError, setExternalError] = useState<OpError>()
  const [configs, setConfigs] = useState<ConfigCatalog>()
  const [configsError, setConfigsError] = useState<OpError>()
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

  const refreshExternal = useCallback(async () => {
    setExternalError(undefined)
    try {
      setExternal(await rest<ExternalView>('GET', '/api/external', undefined, '外部 DSH 检测失败'))
    } catch (error) {
      setExternalError(asOpError(error))
    }
  }, [rest])

  const refreshConfigs = useCallback(async () => {
    setConfigsError(undefined)
    try {
      setConfigs(await rest<ConfigCatalog>('GET', '/api/configs', undefined, '配置列表加载失败'))
    } catch (error) {
      setConfigsError(asOpError(error))
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
      setExternal(undefined)
      setConfigs(undefined)
      return
    }
    void refreshContainers()
    void refreshVersions()
    void refreshSettings()
    void refreshTemplate()
    void refreshModelConfig()
    void refreshExternal()
    void refreshConfigs()
  }, [serviceUp, refreshContainers, refreshVersions, refreshSettings, refreshTemplate, refreshModelConfig, refreshExternal, refreshConfigs])

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

  const setAutoStart = useCallback(async (id: string, enabled: boolean) => {
    try {
      await mutate(`autostart:${id}`, () => rest('POST', `/api/containers/${id}/autostart`, { enabled }, '自动启动开关失败'))
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

  const deletePassthrough = useCallback(async (route: string) => {
    try {
      await mutate('modelConfig', () => rest('DELETE', `/api/model-configs/passthrough/${encodeURIComponent(route)}`, undefined, '目录提供方移除失败'))
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

  /** 检测一个外部路径是 DSH 配置目录还是 harness 检出(只读)。 */
  const checkExternal = useCallback(async (path: string): Promise<ExternalCheck | undefined> => {
    try {
      return await mutate('externalCheck', () => rest<ExternalCheck>('POST', '/api/external/check', { path }, '外部路径检测失败'))
    } catch {
      return undefined
    }
  }, [mutate, rest])

  // 配置设置走同一个 /api/settings:服务端对未传字段保留现值,但 proxy 等字段
  // 会按空串覆盖,因此提交前必须与当前设置合并,避免只改配置开关却清掉网络配置。
  const settingsRef = useRef<DockSettings>()
  settingsRef.current = settings
  const configsRef = useRef<ConfigCatalog>()
  configsRef.current = configs
  const saveConfigSettings = useCallback(async (patch: Partial<Pick<DockSettings, 'configAutoSave' | 'configDir'>>) => {
    const current = settingsRef.current
    if (current === undefined) return false
    try {
      await mutate('configSettings', () => rest('POST', '/api/settings', { ...current, ...patch }, '保存设置失败'))
      void refreshSettings()
      void refreshConfigs()
      return true
    } catch {
      return false
    }
  }, [mutate, rest, refreshSettings, refreshConfigs])

  /**
   * 列举一层目录给页面内选择器用(GET /api/fs/list)。`fallback` 打开时才开:
   * 起始路径可能还不存在,逐级回退到最近的已存在上级目录;用户导航时为 false,
   * 让失效路径直接报错而不是悄悄跳走。
   */
  const browseDirectory = useCallback(async (mode: PathPickerMode, target: string, fallback = false): Promise<FsBrowse> => {
    const candidates = fallback ? ancestorCandidates(target) : [target]
    let failure: OpError | undefined
    for (let index = 0; index < candidates.length; index += 1) {
      try {
        const listing = await rest<FsListing>(
          'GET', `/api/fs/list?mode=${mode}&path=${encodeURIComponent(candidates[index])}`, undefined, '目录读取失败')
        writePickerPath(mode, listing.path)
        return { listing, fellBack: index > 0 }
      } catch (error) {
        failure = asOpError(error)
      }
    }
    return { fellBack: false, ...(failure !== undefined ? { failure } : {}) }
  }, [rest])

  /** 在当前目录下新建一个子目录(POST /api/fs/mkdir);失败返回 undefined。 */
  const makeDirectory = useCallback(async (parent: string, name: string): Promise<string | undefined> => {
    try {
      const created = await rest<{ path?: string }>('POST', '/api/fs/mkdir', { path: parent, name }, '新建文件夹失败')
      return typeof created?.path === 'string' && created.path.length > 0 ? created.path : undefined
    } catch {
      return undefined
    }
  }, [rest])

  /**
   * 选择器的起始路径:选目录用当前解析出的配置目录(设置里的值优先,否则用服务端
   * 解析出的默认目录);选文件用上次访问的目录。空串交给服务端解析为 home。
   */
  const pickerStartPath = useCallback((mode: PathPickerMode): string => {
    if (mode !== 'dir') return readPickerPath(mode)
    const configured = settingsRef.current?.configDir ?? ''
    return configured.length > 0 ? configured : configsRef.current?.dir ?? ''
  }, [])

  /** 读一个配置文件的元信息(不复制、不落地);文件无效或路径不存在时返回 undefined。 */
  const inspectConfig = useCallback(async (target: { file?: string; path?: string }): Promise<ConfigInspectItem | undefined> => {
    try {
      const answer = await mutate('configInspect', () =>
        rest<ConfigInspect>('POST', '/api/configs/inspect', target, '读取配置文件失败'))
      return answer?.item
    } catch {
      return undefined
    }
  }, [mutate, rest])

  /** 保存配置:省略 containerId = 保存全部容器(服务端语义)。 */
  const saveConfigNow = useCallback(async (containerId?: string) => {
    const body = containerId !== undefined && containerId.length > 0 ? { containerId } : {}
    try {
      await mutate('configSave', () => rest<ConfigSaved>('POST', '/api/configs', body, '保存配置失败'))
      void refreshConfigs()
      return true
    } catch {
      return false
    }
  }, [mutate, rest, refreshConfigs])

  // 从配置文件新建容器:目标用 { file }(配置目录里的文件名)或 { path }(磁盘上任意
  // 位置的配置文件)二选一,原样透传给服务端的 /api/configs/restore;服务端返回新容器
  // id,复用现有 container-create 任务轮询。
  const createFromConfig = useCallback(async (
    target: { file?: string; path?: string },
    input: { name: string; version: string; profile?: string },
  ) => {
    const key = target.file ?? target.path ?? ''
    try {
      const answer = await mutate(`configRestore:${key}`, () =>
        rest<{ id: string }>('POST', '/api/configs/restore', { ...target, ...input }, '从配置创建容器失败'))
      watch('container-create', answer.id)
      return true
    } catch {
      return false
    }
  }, [mutate, rest, watch])

  const deleteConfig = useCallback(async (file: string) => {
    try {
      await mutate(`configDelete:${file}`, () => rest('DELETE', `/api/configs/${encodeURIComponent(file)}`, undefined, '删除配置失败'))
      void refreshConfigs()
      return true
    } catch {
      return false
    }
  }, [mutate, rest, refreshConfigs])

  /**
   * 把外部 DSH 的配置保存为配置文件(POST /api/configs + sourcePath)。
   * 只复制、绝不软链;`acknowledge` 由页面勾选框给出,源在运行时服务端据此放行。
   */
  const saveExternalAsConfig = useCallback(async (input: { sourcePath: string; name?: string; acknowledge: boolean }) => {
    try {
      await mutate('externalConfig', () => rest<ConfigImported>(
        'POST', '/api/configs', { sourcePath: input.sourcePath, name: input.name, acknowledge: input.acknowledge }, '保存为配置失败'))
      void refreshConfigs()
      void refreshExternal()
      return true
    } catch {
      return false
    }
  }, [mutate, rest, refreshConfigs, refreshExternal])

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
    external,
    externalError,
    configs,
    configsError,
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
    refreshExternal,
    refreshConfigs,
    checkExternal,
    saveConfigSettings,
    browseDirectory,
    makeDirectory,
    pickerStartPath,
    inspectConfig,
    saveConfigNow,
    createFromConfig,
    deleteConfig,
    saveExternalAsConfig,
    saveModel,
    deleteModel,
    setDefaultModel,
    importModelConfig,
    deletePassthrough,
    createContainer,
    startContainer,
    stopContainer,
    updateContainer,
    deleteContainer,
    setPort,
    setProtect,
    setAutoStart,
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
  /** Read-only external DSH detection (`GET /api/external`). */
  readonly external: ExternalView | undefined
  readonly externalError: OpError | undefined
  /** Configuration-file catalog (`GET /api/configs`). */
  readonly configs: ConfigCatalog | undefined
  readonly configsError: OpError | undefined
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
  refreshExternal: () => Promise<void>
  refreshConfigs: () => Promise<void>
  /** Check one path (read-only); undefined on failure (see `opErrorFor`). */
  checkExternal: (path: string) => Promise<ExternalCheck | undefined>
  /** Persist the configuration groups of `/api/settings` (merged with current values). */
  saveConfigSettings: (patch: Partial<Pick<DockSettings, 'configAutoSave' | 'configDir'>>) => Promise<boolean>
  /** Enumerate one directory level for the in-page picker; `fallback` walks up from a missing start. */
  browseDirectory: (mode: PathPickerMode, target: string, fallback?: boolean) => Promise<FsBrowse>
  /** Create one subdirectory inside `parent`; its path on success, undefined on failure. */
  makeDirectory: (parent: string, name: string) => Promise<string | undefined>
  /** Where the picker opens for this mode: the config directory, or the last visited one ('' = home). */
  pickerStartPath: (mode: PathPickerMode) => string
  /** Read one configuration file's metadata without copying it; undefined when unreadable/invalid. */
  inspectConfig: (target: { file?: string; path?: string }) => Promise<ConfigInspectItem | undefined>
  /** Save a configuration file for one container, or for every container when omitted. */
  saveConfigNow: (containerId?: string) => Promise<boolean>
  /**
   * Create a new container from a configuration file (copy semantics) and watch
   * the task. The target is either `{ file }` (a name in the config directory)
   * or `{ path }` (any file on disk); whichever is given passes through to
   * `POST /api/configs/restore` verbatim.
   */
  createFromConfig: (target: { file?: string; path?: string }, input: { name: string; version: string; profile?: string }) => Promise<boolean>
  deleteConfig: (file: string) => Promise<boolean>
  /** Copy an external DSH home into a configuration file (never a symlink). */
  saveExternalAsConfig: (input: { sourcePath: string; name?: string; acknowledge: boolean }) => Promise<boolean>
  saveModel: (targetUid: string, model: Readonly<Record<string, unknown>>, apiKey: string) => Promise<boolean>
  deleteModel: (uid: string) => Promise<boolean>
  setDefaultModel: (uid: string) => Promise<boolean>
  importModelConfig: (containerId: string) => Promise<boolean>
  deletePassthrough: (route: string) => Promise<boolean>
  createContainer: (input: { name: string; version: string; profile: string }) => Promise<void>
  startContainer: (id: string, force?: boolean) => Promise<void>
  stopContainer: (id: string, force?: boolean) => Promise<void>
  updateContainer: (id: string, version: string, force?: boolean) => Promise<void>
  deleteContainer: (id: string, force?: boolean) => Promise<void>
  setPort: (id: string, port: number) => Promise<boolean>
  setProtect: (id: string, enabled: boolean) => Promise<boolean>
  setAutoStart: (id: string, enabled: boolean) => Promise<boolean>
  installVersion: (tag: string) => Promise<void>
  deleteVersion: (tag: string) => Promise<void>
  saveSettings: (next: DockSettings) => Promise<boolean>
  setBaseUrl: (next: string) => Promise<boolean>
  taskFor: (kind: string, refId: string) => DockTask | undefined
  pending: (kind: string, refId: string) => boolean
  isBusy: (key: string) => boolean
}
