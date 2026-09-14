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
  /** Starts automatically whenever the DSH Dock service starts. */
  readonly autoStart?: boolean
  readonly status: 'running' | 'starting' | 'stopped' | 'failed'
  readonly url?: string
  readonly createdAt?: number
  /** Host log file path, as reported by the service (WebUI `logpath` line). */
  readonly logPath?: string
  readonly self: boolean
}

/** One version-catalog row. */
export interface VersionRow {
  readonly tag: string
  readonly installed: boolean
  /** False for installed versions missing from the remote catalog (WebUI extra rows). */
  readonly remote: boolean
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

/** DSH Dock service settings (`GET/POST /api/settings`). */
export interface DockSettings {
  readonly proxy: string
  readonly githubMirror: string
  readonly npmRegistry: string
  readonly containerPortRange: string
  readonly autoOpenUiOnStart: boolean
  /** Suppress the container's first-open prompts (beta notice + API-key entry). */
  readonly skipFirstOpenPrompts: boolean
}

/** New-container initial-config template (`GET/POST/DELETE /api/profile-template`). */
export interface ProfileTemplate {
  readonly exists: boolean
  readonly capturedAt?: number | null
  readonly source?: string | null
  readonly sections?: readonly string[]
  readonly refKeys?: readonly string[]
}

/** One model row of the model-config table: the model plus its provider connection facts. */
export interface ModelConfigEntry {
  readonly uid: string
  readonly id: string
  readonly name?: string
  readonly api?: string
  readonly baseURL?: string
  readonly apiKeyEnv?: string
  /** Free-form provider name; rows sharing a connection collapse into one provider. */
  readonly label?: string
  readonly contextWindow?: number
  readonly maxTokens?: number
  readonly input?: readonly string[]
  /** `GET` answers only: whether a key is stored (values never leave the server). */
  readonly apiKeySet?: boolean
  /** `GET` answers only: the row authenticates through an Authorization header. */
  readonly hasAuthHeader?: boolean
  readonly headers?: Readonly<Record<string, string>>
  /** `GET` answers only: the auto-grouped provider route this row will land in. */
  readonly route?: string
  readonly providerLabel?: string
}

/** One provider group the table collapses into at container creation. */
export interface ModelConfigProviderGroup {
  readonly route: string
  readonly displayName: string
  readonly api: string
  readonly baseURL: string
  readonly apiKeyEnv: string
  readonly modelCount: number
  readonly apiKeySet: boolean
}

/** `GET /api/model-configs` projection. */
export interface ModelConfigView {
  readonly models: readonly ModelConfigEntry[]
  readonly defaultUid: string
  readonly defaultModel: { readonly provider: string; readonly model: string; readonly uid: string } | null
  readonly providers: readonly ModelConfigProviderGroup[]
  /** Catalog routes carried verbatim (no explicit model list; DSH's catalog serves them). */
  readonly passthrough: readonly { readonly route: string; readonly displayName: string; readonly apiKeyEnv: string; readonly apiKeySet: boolean }[]
  readonly protocols: readonly string[]
  readonly rawSectionKeys?: readonly string[]
  readonly importedFrom?: {
    readonly containerName?: string
    readonly at?: number
    readonly migratedFromLegacy?: boolean
  } | null
}

/** `POST /api/model-configs/import` summary. */
export interface ModelConfigImport {
  readonly added: readonly string[]
  readonly updated: readonly string[]
  readonly skipped: readonly string[]
  readonly refKeys: readonly string[]
  readonly source?: string
  readonly defaultSet?: boolean
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

/** Renderable operation failure carried by answers that are not exceptions. */
export interface OpError {
  readonly title: string
  readonly detail?: string
  readonly output?: readonly string[]
}
