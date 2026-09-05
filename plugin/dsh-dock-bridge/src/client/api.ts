/**
 * Typed contracts shared by the "DSH Dock" section cards. The browser half
 * reaches the Host through the `/dshdock-plugins` connection channel: plugin
 * operations return plain payloads, container/version/settings operations
 * ride the allowlisted `dock.rest` proxy whose answers keep the server's own
 * status codes and error messages verbatim.
 */

/** Generic connection-channel failure. */
export interface RpcFail {
  readonly code: string
  readonly message: string
  readonly details: Readonly<Record<string, unknown>>
}

/** Connection-channel result envelope (ConnectionRpcResult). */
export type RpcEnvelope<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RpcFail }

/** `dock.rest` answer: the service's own status plus parsed body. */
export interface RestAnswer<T = unknown> {
  readonly status: number
  readonly body: T
}

/** `dock.status` — environment probe result. */
export interface DockStatus {
  readonly dshdockContainer: boolean
  readonly selfContainerId?: string
  readonly serviceReachable: boolean
  readonly baseUrl: string
}

/** One container as the DSH Dock REST service reports it. */
export interface ContainerRow {
  readonly id: string
  readonly name: string
  readonly version?: string
  readonly profile?: string
  readonly port?: number
  readonly devProtect?: boolean
  readonly status: 'running' | 'starting' | 'stopped' | 'failed'
  readonly url?: string
  readonly createdAt?: number
  readonly self: boolean
}

/** One version-catalog row. */
export interface VersionRow {
  readonly tag: string
  readonly installed: boolean
}

/** `GET /api/versions/catalog` projection. */
export interface VersionCatalog {
  readonly fetchedAt?: number
  readonly warning?: string
  readonly versions: readonly VersionRow[]
}

/** Raw `/api/versions/catalog` answer (tags are `{name, sha}` objects). */
export interface RawVersionCatalog {
  readonly fetchedAt?: number
  readonly warning?: string
  readonly tags?: readonly (string | { readonly name?: string })[]
  readonly installed?: readonly string[]
}

/** One profile extension plugin. */
export interface PluginRow {
  readonly name: string
  readonly version?: string
  readonly spec?: string
  readonly kind: 'file' | 'link' | 'registry' | 'none'
  readonly installed: boolean
  readonly active: boolean
  readonly disabled: boolean
  readonly self: boolean
}

/** `list` answer for the plugins card. */
export interface PluginList {
  readonly ok: boolean
  readonly recognized?: boolean
  readonly plugins: readonly PluginRow[]
}

/** DSH Dock service settings (`GET/POST /api/settings`). */
export interface DockSettings {
  readonly proxy: string
  readonly githubMirror: string
  readonly npmRegistry: string
  readonly containerPortRange: string
  readonly autoOpenUiOnStart: boolean
}

/** One DSH Dock background task (tool and page share this projection). */
export interface DockTask {
  readonly id: string
  readonly kind: string
  readonly refId?: string
  readonly label: string
  readonly status: 'running' | 'succeeded' | 'failed'
  readonly error?: string
  readonly startedAt?: number
  readonly finishedAt?: number
  readonly lines?: readonly string[]
}

/** Payload shape returned by the plugin-operation endpoints. */
export interface PluginOpAnswer {
  readonly ok: boolean
  readonly error?: string
  readonly hint?: string
  readonly output?: readonly string[]
  readonly plugins?: readonly PluginRow[]
  readonly recognized?: boolean
}

/** Renderable operation failure carried by answers that are not exceptions. */
export interface OpError {
  readonly title: string
  readonly detail?: string
  readonly output?: readonly string[]
}
