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
  /** Automatically save a configuration on container create/update (default off). */
  readonly configAutoSave: boolean
  /** Configuration-file directory; empty = `DATA_ROOT/configs`. */
  readonly configDir: string
  /** Configuration files kept per container (`0` disables pruning). */
  readonly configKeep: number
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

/** One externally discovered DSH home (read-only facts). */
export interface ExternalHome {
  readonly path: string
  readonly isHome: boolean
  /** Signal files/directories that made this look like a DSH home. */
  readonly signals?: readonly string[]
  readonly sessions: number
  readonly hasCredentials: boolean
  readonly hasSettings: boolean
  readonly files: number
  readonly bytes: number
  /** Whether a running DSH host was matched to this home. */
  readonly inUse: boolean
  readonly pid: number | null
}

/** One externally discovered harness checkout (a version candidate). */
export interface ExternalCheckout {
  readonly path: string
  readonly version: string
  readonly prebuilt: boolean
  readonly inUse?: boolean
  readonly pid?: number | null
}

/** One npx/global `dsh` installation found outside DSH Dock. */
export interface ExternalInstalled {
  readonly kind: 'npx' | 'global'
  readonly path: string
  readonly version: string
}

/** One running DSH host process found by the read-only probe. */
export interface ExternalRunning {
  readonly pid: number
  readonly cmdline: string
  readonly port: number | null
  readonly home: string | null
}

/** One DSH Dock container row as `GET /api/external` reports it. */
export interface ExternalContainer {
  readonly id: string
  readonly name: string
  readonly status: string
  /** Configuration file this container was created from, else null. */
  readonly configFile: string | null
}

/** `GET /api/external`: read-only detection of everything outside DSH Dock. */
export interface ExternalView {
  readonly officialHome: string
  readonly configDir: string
  readonly configAutoSave: boolean
  readonly homes: readonly ExternalHome[]
  readonly checkouts: readonly ExternalCheckout[]
  readonly installed: readonly ExternalInstalled[]
  readonly running: readonly ExternalRunning[]
  /** DSHBox's own container host processes filtered out of `running`. */
  readonly managedRunning: number
  /** False on platforms that cannot read a process's DSH_HOME: ask the user. */
  readonly canDetectUsage: boolean
  readonly containers: readonly ExternalContainer[]
}

/** `POST /api/external/check`: validate one path (home and/or harness). */
export interface ExternalCheck {
  readonly path: string
  readonly isHome: boolean
  readonly home: ExternalHome
  readonly isHarness: boolean
  readonly harness: { readonly version: string; readonly prebuilt: boolean }
  readonly usage: { readonly known: boolean; readonly inUse: boolean; readonly pid: number | null }
  /** What this path is good for: a config to save, or a version to install. */
  readonly suggestion: 'config' | 'version' | null
}

/**
 * One configuration-file row of `GET /api/configs`. The `valid`/`error` pair
 * describes whether the file could be read: an unreadable file still lists
 * (name falls back to the file name) but can only be deleted.
 */
export interface ConfigRow {
  /** Configuration file name; restore and delete both address it. */
  readonly file: string
  readonly name: string
  readonly bytes: number
  readonly modifiedAt: number
  readonly valid: boolean
  readonly error: string | null
  readonly containerId?: string | null
  readonly version?: string | null
  readonly profile?: string
  readonly port?: number | null
  /** `manual | created | pre-update | pre-delete | import`. */
  readonly reason?: string
  readonly note?: string
  readonly createdAt?: number | null
  readonly files?: number
  readonly sessions?: number
  readonly hasCredentials?: boolean
  /** Original DSH_HOME this configuration was packed from. */
  readonly source?: string | null
}

/** `GET /api/configs` projection. */
export interface ConfigCatalog {
  readonly dir: string
  readonly autoSave: boolean
  readonly keep: number
  readonly items: readonly ConfigRow[]
}

/** `POST /api/configs` answer for container targets (no `containerId` = save every container). */
export interface ConfigSaved {
  readonly ok: boolean
  readonly created: readonly string[]
  readonly items: readonly ConfigRow[]
}

/** `POST /api/configs` answer for an external source (copy semantics, never a symlink). */
export interface ConfigImported {
  readonly ok: boolean
  readonly file: string
  readonly item: ConfigRow
  /** Server-side risk notes; the page shows its own list before submitting. */
  readonly risks: readonly string[]
}
