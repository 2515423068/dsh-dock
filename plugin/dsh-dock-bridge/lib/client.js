window.__ModuleLoader__.load({
	id: "dsh-dock-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/use-dock.ts
		/**
		* Data hook behind the "DSH Dock" section. One cohesive view state for the
		* three cards: environment status, containers, versions,
		* service settings, and the watched background tasks. Mutations go through
		* the `/dshdock-plugins` channel; long tasks are followed by 1s polling of
		* the service task list (the same kind+refId semantics the tools use), and
		* a settled task refreshes the affected lists.
		*/
		const POLL_INTERVAL_MS = 1e3;
		/** Extract an OpError from a dock.rest answer (transport failures included). */
		function toOpError(answer, fallbackTitle) {
			const body = answer.body;
			const message = body !== null && typeof body === "object" && typeof body.error === "string" ? body.error : `HTTP ${answer.status}`;
			const hint = body !== null && typeof body === "object" && typeof body.hint === "string" ? body.hint : void 0;
			return {
				title: `${fallbackTitle}: ${message}`,
				detail: hint
			};
		}
		/** Coerce any thrown value into an OpError (REST failures are plain OpErrors). */
		function asOpError(error) {
			if (typeof error === "object" && error !== null && typeof error.title === "string") return error;
			return { title: error instanceof Error ? error.message : String(error) };
		}
		/**
		* Per-container record of the user's protect choice (browser-local): the
		* automatic default-enable fires at most once, then manual choice wins.
		*/
		function protectChoiceKey(id) {
			return `dshdock-autoprotect:${id}`;
		}
		/** Whether this browser already settled the protect default for one container. */
		function hasProtectChoice(id) {
			try {
				return window.localStorage.getItem(protectChoiceKey(id)) !== null;
			} catch {
				return true;
			}
		}
		/** Record the protect choice: called by the auto-enable and by the manual checkbox. */
		function markProtectChoice(id) {
			try {
				window.localStorage.setItem(protectChoiceKey(id), "1");
			} catch {}
		}
		/**
		* The section's whole data/operation surface.
		* @param call - channel caller provided by the plugin apply closure.
		*/
		function useDock(call) {
			const [status, setStatus] = (0, react.useState)();
			const [statusError, setStatusError] = (0, react.useState)();
			const [containers, setContainers] = (0, react.useState)([]);
			const [containersError, setContainersError] = (0, react.useState)();
			const [versions, setVersions] = (0, react.useState)();
			const [versionsError, setVersionsError] = (0, react.useState)();
			const [settings, setSettings] = (0, react.useState)();
			const [settingsError, setSettingsError] = (0, react.useState)();
			const [template, setTemplate] = (0, react.useState)();
			const [templateError, setTemplateError] = (0, react.useState)();
			const [modelConfig, setModelConfig] = (0, react.useState)();
			const [modelConfigError, setModelConfigError] = (0, react.useState)();
			const [external, setExternal] = (0, react.useState)();
			const [externalError, setExternalError] = (0, react.useState)();
			const [configs, setConfigs] = (0, react.useState)();
			const [configsError, setConfigsError] = (0, react.useState)();
			const [tasks, setTasks] = (0, react.useState)([]);
			const [busyOps, setBusyOps] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const [opError, setOpError] = (0, react.useState)();
			const [watching, setWatching] = (0, react.useState)([]);
			const callRef = (0, react.useRef)(call);
			callRef.current = call;
			const statusRef = (0, react.useRef)();
			statusRef.current = status;
			const serviceUp = status?.serviceReachable === true;
			const markBusy = (0, react.useCallback)((key, busy) => {
				setBusyOps((previous) => {
					const next = new Set(previous);
					if (busy) next.add(key);
					else next.delete(key);
					return next;
				});
			}, []);
			/** One allowlisted REST call; non-2xx answers become thrown OpErrors. */
			const rest = (0, react.useCallback)(async (method, path, body, failTitle = "操作失败") => {
				const answer = await callRef.current("dock.rest", {
					method,
					path,
					body
				});
				if (answer.status === 0) throw toOpError(answer, failTitle);
				if (answer.status >= 400) throw toOpError(answer, failTitle);
				return answer.body;
			}, []);
			const refreshStatus = (0, react.useCallback)(async () => {
				setStatusError(void 0);
				try {
					setStatus(await callRef.current("dock.status"));
				} catch (error) {
					setStatusError(error instanceof Error ? error.message : String(error));
				}
			}, []);
			const refreshContainers = (0, react.useCallback)(async () => {
				setContainersError(void 0);
				try {
					const rows = await rest("GET", "/api/containers", void 0, "容器列表加载失败");
					const selfId = statusRef.current?.selfContainerId;
					setContainers(rows.map((row) => ({
						...row,
						self: selfId !== void 0 && row.id === selfId
					})));
				} catch (error) {
					setContainersError(asOpError(error));
				}
			}, [rest]);
			const refreshVersions = (0, react.useCallback)(async (refreshCatalog = false) => {
				setVersionsError(void 0);
				if (refreshCatalog) markBusy("versionsRefresh", true);
				try {
					const raw = await rest("GET", `/api/versions/catalog${refreshCatalog ? "?refresh=1" : ""}`, void 0, "版本目录加载失败");
					const installed = new Set(raw.installed ?? []);
					const seen = /* @__PURE__ */ new Set();
					const versions = (raw.tags ?? []).map((entry) => {
						const tag = typeof entry === "string" ? entry : entry?.name ?? "";
						seen.add(tag);
						return {
							tag,
							installed: installed.has(tag),
							remote: true
						};
					}).filter((entry) => entry.tag.length > 0);
					for (const name of installed) if (!seen.has(name)) versions.push({
						tag: name,
						installed: true,
						remote: false
					});
					setVersions({
						fetchedAt: raw.fetchedAt,
						warning: raw.warning,
						versions
					});
				} catch (error) {
					setVersionsError(asOpError(error));
				} finally {
					if (refreshCatalog) markBusy("versionsRefresh", false);
				}
			}, [rest, markBusy]);
			const refreshSettings = (0, react.useCallback)(async () => {
				setSettingsError(void 0);
				try {
					setSettings(await rest("GET", "/api/settings", void 0, "设置加载失败"));
				} catch (error) {
					setSettingsError(asOpError(error));
				}
			}, [rest]);
			const refreshTemplate = (0, react.useCallback)(async () => {
				setTemplateError(void 0);
				try {
					setTemplate(await rest("GET", "/api/profile-template", void 0, "配置模板加载失败"));
				} catch (error) {
					setTemplateError(asOpError(error));
				}
			}, [rest]);
			const refreshModelConfig = (0, react.useCallback)(async () => {
				setModelConfigError(void 0);
				try {
					setModelConfig(await rest("GET", "/api/model-configs", void 0, "模型配置加载失败"));
				} catch (error) {
					setModelConfigError(asOpError(error));
				}
			}, [rest]);
			const refreshExternal = (0, react.useCallback)(async () => {
				setExternalError(void 0);
				try {
					setExternal(await rest("GET", "/api/external", void 0, "外部 DSH 检测失败"));
				} catch (error) {
					setExternalError(asOpError(error));
				}
			}, [rest]);
			const refreshConfigs = (0, react.useCallback)(async () => {
				setConfigsError(void 0);
				try {
					setConfigs(await rest("GET", "/api/configs", void 0, "配置列表加载失败"));
				} catch (error) {
					setConfigsError(asOpError(error));
				}
			}, [rest]);
			(0, react.useCallback)(async () => {
				try {
					setTasks(await rest("GET", "/api/tasks", void 0, "任务列表加载失败"));
				} catch {}
			}, [rest]);
			/** Follow one submitted task until it settles, then refresh the lists. */
			const watch = (0, react.useCallback)((kind, refId) => {
				setWatching((previous) => previous.some((entry) => entry.kind === kind && entry.refId === refId) ? previous : [...previous, {
					kind,
					refId
				}]);
			}, []);
			(0, react.useEffect)(() => {
				if (watching.length === 0) return;
				let disposed = false;
				const tick = async () => {
					if (disposed) return;
					try {
						const list = await rest("GET", "/api/tasks", void 0, "任务轮询失败");
						if (disposed) return;
						setTasks(list);
						const settled = watching.filter(({ kind, refId }) => {
							const task = list.find((entry) => entry.kind === kind && entry.refId === refId);
							return task !== void 0 && task.status !== "running";
						});
						if (settled.length > 0) {
							setWatching((previous) => previous.filter((entry) => !settled.some((settledEntry) => settledEntry.kind === entry.kind && settledEntry.refId === entry.refId)));
							refreshContainers();
							refreshVersions();
						}
					} catch {}
				};
				const timer = window.setInterval(() => {
					tick();
				}, POLL_INTERVAL_MS);
				tick();
				return () => {
					disposed = true;
					window.clearInterval(timer);
				};
			}, [
				watching,
				rest,
				refreshContainers,
				refreshVersions
			]);
			(0, react.useEffect)(() => {
				refreshStatus();
			}, [refreshStatus]);
			(0, react.useEffect)(() => {
				if (!serviceUp) {
					setContainers([]);
					setVersions(void 0);
					setSettings(void 0);
					setTemplate(void 0);
					setModelConfig(void 0);
					setExternal(void 0);
					setConfigs(void 0);
					return;
				}
				refreshContainers();
				refreshVersions();
				refreshSettings();
				refreshTemplate();
				refreshModelConfig();
				refreshExternal();
				refreshConfigs();
			}, [
				serviceUp,
				refreshContainers,
				refreshVersions,
				refreshSettings,
				refreshTemplate,
				refreshModelConfig,
				refreshExternal,
				refreshConfigs
			]);
			const taskFor = (0, react.useCallback)((kind, refId) => tasks.find((entry) => entry.kind === kind && entry.refId === refId), [tasks]);
			const pending = (0, react.useCallback)((kind, refId) => {
				const task = taskFor(kind, refId);
				return task !== void 0 && task.status === "running";
			}, [taskFor]);
			/** Run one mutation with a busy key; the failure is scoped to that key. */
			const mutate = (0, react.useCallback)(async (key, work) => {
				markBusy(key, true);
				setOpError(void 0);
				try {
					return await work();
				} catch (error) {
					setOpError({
						...asOpError(error),
						key
					});
					throw error;
				} finally {
					markBusy(key, false);
				}
			}, [markBusy]);
			const createContainer = (0, react.useCallback)(async (input) => {
				const answer = await mutate("create", async () => rest("POST", "/api/containers", input, "创建失败"));
				watch("container-create", answer.id);
			}, [
				mutate,
				rest,
				watch
			]);
			const startContainer = (0, react.useCallback)(async (id, force = false) => {
				await mutate(`start:${id}`, () => rest("POST", `/api/containers/${id}/start`, force ? { force } : void 0, "启动失败"));
				watch("container-start", id);
			}, [
				mutate,
				rest,
				watch
			]);
			const stopContainer = (0, react.useCallback)(async (id, force = false) => {
				await mutate(`stop:${id}`, () => rest("POST", `/api/containers/${id}/stop`, force ? { force } : void 0, "停止失败"));
				refreshContainers();
			}, [
				mutate,
				rest,
				refreshContainers
			]);
			const updateContainer = (0, react.useCallback)(async (id, version, force = false) => {
				await mutate(`update:${id}`, () => rest("POST", `/api/containers/${id}/update`, {
					version,
					...force ? { force } : {}
				}, "更新失败"));
				watch("container-update", id);
			}, [
				mutate,
				rest,
				watch
			]);
			const deleteContainer = (0, react.useCallback)(async (id, force = false) => {
				await mutate(`delete:${id}`, () => rest("DELETE", `/api/containers/${id}`, {
					confirmDevProtect: true,
					...force ? { force } : {}
				}, "删除失败"));
				refreshContainers();
			}, [
				mutate,
				rest,
				refreshContainers
			]);
			const setPort = (0, react.useCallback)(async (id, port) => {
				try {
					await mutate(`port:${id}`, () => rest("POST", `/api/containers/${id}/port`, { port }, "改端口失败"));
					return true;
				} catch {
					return false;
				}
			}, [mutate, rest]);
			const setProtect = (0, react.useCallback)(async (id, enabled) => {
				try {
					await mutate(`protect:${id}`, () => rest("POST", `/api/containers/${id}/protect`, { enabled }, "保护开关失败"));
					refreshContainers();
					return true;
				} catch {
					return false;
				}
			}, [
				mutate,
				rest,
				refreshContainers
			]);
			const setAutoStart = (0, react.useCallback)(async (id, enabled) => {
				try {
					await mutate(`autostart:${id}`, () => rest("POST", `/api/containers/${id}/autostart`, { enabled }, "自动启动开关失败"));
					refreshContainers();
					return true;
				} catch {
					return false;
				}
			}, [
				mutate,
				rest,
				refreshContainers
			]);
			const protectAttempted = (0, react.useRef)();
			(0, react.useEffect)(() => {
				if (!serviceUp) return;
				const selfRow = containers.find((row) => row.self);
				if (selfRow === void 0 || selfRow.devProtect === true) return;
				if (protectAttempted.current === selfRow.id) return;
				protectAttempted.current = selfRow.id;
				if (hasProtectChoice(selfRow.id)) return;
				markProtectChoice(selfRow.id);
				setProtect(selfRow.id, true);
			}, [
				serviceUp,
				containers,
				setProtect
			]);
			const installVersion = (0, react.useCallback)(async (tag) => {
				await mutate(`install:${tag}`, () => rest("POST", "/api/versions/install", { tag }, "安装失败"));
				watch("version-install", tag);
			}, [
				mutate,
				rest,
				watch
			]);
			const deleteVersion = (0, react.useCallback)(async (tag) => {
				await mutate(`versionDelete:${tag}`, () => rest("DELETE", `/api/versions/${encodeURIComponent(tag)}`, void 0, "删除版本失败"));
				refreshVersions();
			}, [
				mutate,
				rest,
				refreshVersions
			]);
			const saveSettings = (0, react.useCallback)(async (next) => {
				try {
					await mutate("settings", () => rest("POST", "/api/settings", next, "保存设置失败"));
					refreshSettings();
					return true;
				} catch {
					return false;
				}
			}, [
				mutate,
				rest,
				refreshSettings
			]);
			const saveModel = (0, react.useCallback)(async (targetUid, model, apiKey) => {
				try {
					const body = apiKey === "" ? { model } : {
						model,
						apiKey
					};
					await mutate("modelConfig", () => rest("PUT", `/api/model-configs/models/${encodeURIComponent(targetUid)}`, body, "模型保存失败"));
					refreshModelConfig();
					return true;
				} catch {
					return false;
				}
			}, [
				mutate,
				rest,
				refreshModelConfig
			]);
			const deleteModel = (0, react.useCallback)(async (uid) => {
				try {
					await mutate("modelConfig", () => rest("DELETE", `/api/model-configs/models/${encodeURIComponent(uid)}`, void 0, "模型删除失败"));
					refreshModelConfig();
					return true;
				} catch {
					return false;
				}
			}, [
				mutate,
				rest,
				refreshModelConfig
			]);
			const setDefaultModel = (0, react.useCallback)(async (uid) => {
				try {
					await mutate("modelConfig", () => rest("POST", "/api/model-configs/default", { uid }, "默认模型保存失败"));
					refreshModelConfig();
					return true;
				} catch {
					return false;
				}
			}, [
				mutate,
				rest,
				refreshModelConfig
			]);
			const deletePassthrough = (0, react.useCallback)(async (route) => {
				try {
					await mutate("modelConfig", () => rest("DELETE", `/api/model-configs/passthrough/${encodeURIComponent(route)}`, void 0, "目录提供方移除失败"));
					refreshModelConfig();
					return true;
				} catch {
					return false;
				}
			}, [
				mutate,
				rest,
				refreshModelConfig
			]);
			const importModelConfig = (0, react.useCallback)(async (containerId) => {
				try {
					await mutate("modelConfig", () => rest("POST", "/api/model-configs/import", { containerId }, "模型配置导入失败"));
					refreshModelConfig();
					return true;
				} catch {
					return false;
				}
			}, [
				mutate,
				rest,
				refreshModelConfig
			]);
			/** 检测一个外部路径是 DSH 配置目录还是 harness 检出(只读)。 */
			const checkExternal = (0, react.useCallback)(async (path) => {
				try {
					return await mutate("externalCheck", () => rest("POST", "/api/external/check", { path }, "外部路径检测失败"));
				} catch {
					return;
				}
			}, [mutate, rest]);
			const settingsRef = (0, react.useRef)();
			settingsRef.current = settings;
			const saveConfigSettings = (0, react.useCallback)(async (patch) => {
				const current = settingsRef.current;
				if (current === void 0) return false;
				try {
					await mutate("configSettings", () => rest("POST", "/api/settings", {
						...current,
						...patch
					}, "保存设置失败"));
					refreshSettings();
					refreshConfigs();
					return true;
				} catch {
					return false;
				}
			}, [
				mutate,
				rest,
				refreshSettings,
				refreshConfigs
			]);
			/** 保存配置:省略 containerId = 保存全部容器(服务端语义)。 */
			const saveConfigNow = (0, react.useCallback)(async (containerId) => {
				const body = containerId !== void 0 && containerId.length > 0 ? { containerId } : {};
				try {
					await mutate("configSave", () => rest("POST", "/api/configs", body, "保存配置失败"));
					refreshConfigs();
					return true;
				} catch {
					return false;
				}
			}, [
				mutate,
				rest,
				refreshConfigs
			]);
			const createFromConfig = (0, react.useCallback)(async (file, input) => {
				try {
					const answer = await mutate(`configRestore:${file}`, () => rest("POST", "/api/configs/restore", {
						file,
						...input
					}, "从配置创建容器失败"));
					watch("container-create", answer.id);
					return true;
				} catch {
					return false;
				}
			}, [
				mutate,
				rest,
				watch
			]);
			const deleteConfig = (0, react.useCallback)(async (file) => {
				try {
					await mutate(`configDelete:${file}`, () => rest("DELETE", `/api/configs/${encodeURIComponent(file)}`, void 0, "删除配置失败"));
					refreshConfigs();
					return true;
				} catch {
					return false;
				}
			}, [
				mutate,
				rest,
				refreshConfigs
			]);
			/**
			* 把外部 DSH 的配置保存为配置文件(POST /api/configs + sourcePath)。
			* 只复制、绝不软链;`acknowledge` 由页面勾选框给出,源在运行时服务端据此放行。
			*/
			const saveExternalAsConfig = (0, react.useCallback)(async (input) => {
				try {
					await mutate("externalConfig", () => rest("POST", "/api/configs", {
						sourcePath: input.sourcePath,
						name: input.name,
						acknowledge: input.acknowledge
					}, "保存为配置失败"));
					refreshConfigs();
					refreshExternal();
					return true;
				} catch {
					return false;
				}
			}, [
				mutate,
				rest,
				refreshConfigs,
				refreshExternal
			]);
			const setBaseUrl = (0, react.useCallback)(async (next) => {
				try {
					await mutate("baseUrl", () => callRef.current("dock.baseUrl", { baseUrl: next }));
					await refreshStatus();
					return true;
				} catch {
					return false;
				}
			}, [mutate, refreshStatus]);
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
				clearOpError: () => {
					setOpError(void 0);
				},
				opErrorFor: (prefixes) => opError !== void 0 && prefixes.some((prefix) => opError.key === prefix || opError.key.startsWith(prefix)) ? opError : void 0,
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
				isBusy: (key) => busyOps.has(key)
			};
		}
		//#endregion
		//#region \0dshdock-css:/home/hao/DSHProgram/DSHBox/plugin/dsh-dock-bridge/src/client/DockSection.module.css.mjs
		const css = ".yFwJXq_section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}.yFwJXq_title{margin:0;font-size:18px;font-weight:600}.yFwJXq_intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px}.yFwJXq_tabs{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:flex-end;gap:22px;margin-top:2px;display:flex}.yFwJXq_tab{color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:0;padding:7px 1px 9px;font-size:13px;line-height:20px;position:relative}.yFwJXq_tab:hover,.yFwJXq_tab[data-active=true]{color:var(--dsw-alias-label-primary)}.yFwJXq_tab[data-active=true]:after,.yFwJXq_tab:focus-visible:after{background:var(--dsw-alias-label-primary);content:\"\";border-radius:2px 2px 0 0;height:2px;position:absolute;bottom:-1px;left:0;right:0}.yFwJXq_tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:2px}.yFwJXq_tabPanel{min-width:0;padding-top:2px}.yFwJXq_card{border:.5px solid var(--dsw-alias-border-l4);background:0 0;border-radius:16px;flex-direction:column;gap:10px;padding:14px 16px;display:flex}.yFwJXq_cardHead{align-items:center;gap:8px;display:flex}.yFwJXq_cardTitle{letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;font-weight:600}.yFwJXq_cardActions{align-items:center;gap:6px;margin-left:auto;display:flex}.yFwJXq_cardBody{flex-direction:column;gap:6px;display:flex}.yFwJXq_rows{flex-direction:column;gap:12px;margin:0;padding:0;list-style:none;display:flex}.yFwJXq_row{border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;flex-direction:column;align-items:stretch;padding:14px 16px;display:flex}.yFwJXq_rowHead{align-items:center;gap:10px;margin-bottom:8px;display:flex}.yFwJXq_rowTitle{text-overflow:ellipsis;white-space:nowrap;font-size:15px;font-weight:500;line-height:22px;overflow:hidden}.yFwJXq_rowMeta{color:var(--dsw-alias-label-tertiary);margin-bottom:10px;font-size:13px;line-height:20px}.yFwJXq_verSelect,.yFwJXq_ddTrigger{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-2);height:30px;color:var(--dsw-alias-label-primary);vertical-align:middle;border-radius:8px;padding:0 8px;font-size:12.5px;line-height:18px}.yFwJXq_logPath{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:16px;font-family:var(--ds-font-family-code);word-break:break-all;margin-bottom:8px}.yFwJXq_rowUrl{min-width:0;margin-bottom:10px;overflow:hidden}.yFwJXq_rowActions{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.yFwJXq_table{border-collapse:collapse;width:100%;font-size:13px;line-height:20px}.yFwJXq_table th{text-align:left;color:var(--dsw-alias-label-tertiary);border-bottom:.5px solid var(--dsw-alias-border-l2);padding:10px;font-size:12px;font-weight:500;line-height:18px}.yFwJXq_table td{border-bottom:.5px solid var(--dsw-alias-border-l1);vertical-align:middle;padding:10px}.yFwJXq_table tbody tr:last-child td{border-bottom:none}.yFwJXq_cellAction{white-space:nowrap}.yFwJXq_mutedCell{color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:20px}.yFwJXq_dot{flex:none}.yFwJXq_statusLabel{height:24px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);white-space:nowrap;border-radius:12px;align-items:center;padding:0 10px;font-size:12px;line-height:18px;display:inline-flex}.yFwJXq_statusLabel[data-status=running]{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent)}.yFwJXq_statusLabel[data-status=starting]{color:var(--dsw-alias-state-warn-label);background:color-mix(in srgb, var(--dsw-alias-state-warn-label) 12%, transparent)}.yFwJXq_statusLabel[data-status=failed]{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)}.yFwJXq_selfBadge{white-space:nowrap;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-radius:999px;flex:none;padding:2px 10px;font-size:12px;font-weight:600;line-height:18px}.yFwJXq_builtinBadge{white-space:nowrap;background:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.yFwJXq_link{color:var(--dsw-alias-link);word-break:break-all;font-size:12.5px;font-weight:500;line-height:20px;text-decoration:none}.yFwJXq_link:hover{text-underline-offset:3px;text-decoration:underline dotted}.yFwJXq_guide{border:.5px solid var(--dsw-alias-state-warn-primary);border-radius:12px;flex-direction:column;gap:8px;padding:12px 14px;display:flex}.yFwJXq_guideTitle{color:var(--dsw-alias-state-warn-label);align-items:center;gap:6px;margin:0;font-size:13px;font-weight:600;display:flex}.yFwJXq_guideBody{color:var(--dsw-alias-label-secondary);white-space:pre-line;margin:0;font-size:12px}.yFwJXq_baseUrlRow{flex-wrap:wrap;align-items:center;gap:6px;display:flex}.yFwJXq_baseUrlNote{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}.yFwJXq_errorNote{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);color:var(--dsw-alias-state-error-primary);border-radius:10px;flex-direction:column;gap:4px;padding:8px 12px;font-size:12px;display:flex}.yFwJXq_errorLine{overflow-wrap:anywhere;margin:0}.yFwJXq_taskInline{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border-radius:10px;flex-direction:column;gap:2px;padding:6px 12px;font-size:12px;display:flex}.yFwJXq_taskHead{align-items:center;gap:6px;display:flex}.yFwJXq_taskLine{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;margin:0;font-size:11px;overflow:hidden}.yFwJXq_taskFailed{color:var(--dsw-alias-state-error-primary)}.yFwJXq_outputTail{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;border-radius:8px;max-height:160px;margin:0;padding:8px 10px;font-size:11px;line-height:1.5;overflow:auto}.yFwJXq_subTitle{margin:6px 0 0;font-size:15px;font-weight:500;line-height:22px}.yFwJXq_rowLine{flex-wrap:wrap;align-items:center;gap:10px;display:flex}.yFwJXq_labelCol{width:120px;color:var(--dsw-alias-label-tertiary);flex:none;font-size:12.5px;line-height:20px}.yFwJXq_chipRow{flex-wrap:wrap;gap:6px;display:inline-flex}.yFwJXq_hintIcon{vertical-align:middle;color:var(--dsw-alias-label-tertiary);cursor:help;border-radius:4px;margin-left:2px;display:inline-flex}.yFwJXq_hintIcon:hover{color:var(--dsw-alias-label-primary)}.yFwJXq_hintIcon:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.yFwJXq_rangeInput{width:150px}.yFwJXq_saveRow{margin-top:10px;display:flex}.yFwJXq_formGrid{flex-direction:column;gap:8px;padding-top:2px;display:flex}.yFwJXq_formRow{grid-template-columns:160px 1fr;align-items:center;gap:10px;display:grid}.yFwJXq_formLabel{color:var(--dsw-alias-label-secondary);font-size:12px}.yFwJXq_inlineForm{border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;flex-direction:column;gap:8px;padding:10px 12px;display:flex}.yFwJXq_inlineFormRow{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.yFwJXq_inlineFormActions{justify-content:flex-end;align-items:center;gap:6px;display:flex}.yFwJXq_grow{flex:160px;min-width:140px}.yFwJXq_narrow{width:120px}.yFwJXq_checkboxRow{color:var(--dsw-alias-label-primary);align-items:center;gap:6px;font-size:12px;display:flex}.yFwJXq_empty{text-align:center;color:var(--dsw-alias-label-tertiary);margin:0;padding:30px 0;font-size:13.5px;line-height:22px}.yFwJXq_footerNote{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}.yFwJXq_mono{font-family:var(--ds-font-family-code);word-break:break-all;font-size:12px}.yFwJXq_warnNote{color:var(--dsw-alias-state-warn-label);align-items:center;gap:6px;margin:0;font-size:12px;display:flex}.yFwJXq_riskList{color:var(--dsw-alias-label-secondary);flex-direction:column;gap:4px;margin:0;padding-left:18px;font-size:12px;line-height:18px;display:flex}.yFwJXq_riskItem{overflow-wrap:anywhere}.yFwJXq_stoppedDot{background:var(--dsw-alias-border-l3);border-radius:50%;flex:none;width:10px;height:10px}.yFwJXq_spin{animation:1s linear infinite yFwJXq_dshdock-spin}@keyframes yFwJXq_dshdock-spin{to{transform:rotate(360deg)}}.yFwJXq_providerRow{border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:6px;padding:8px 10px;display:flex}.yFwJXq_providerName{font-size:13.5px;font-weight:500;line-height:20px}.yFwJXq_providerActions{gap:6px;margin-left:auto;display:flex}.yFwJXq_dotOk,.yFwJXq_dotMiss{border-radius:50%;flex:none;width:8px;height:8px}.yFwJXq_dotOk{background:var(--dsw-alias-state-success)}.yFwJXq_dotMiss{background:var(--dsw-alias-state-error)}.yFwJXq_modelRow{grid-template-columns:minmax(0,1.6fr) minmax(0,1.2fr) 110px 110px auto;align-items:center;gap:6px;margin-bottom:6px;display:grid}.yFwJXq_dd{width:100%;max-width:100%;display:block;position:relative}.yFwJXq_ddName{white-space:nowrap;flex:none}.yFwJXq_ddProv{white-space:nowrap;text-overflow:ellipsis;min-width:0;color:var(--dsw-alias-label-tertiary);overflow:hidden}.yFwJXq_ddTrigger{cursor:pointer;align-items:center;gap:10px;width:100%;max-width:100%;display:flex}.yFwJXq_ddLabel{white-space:nowrap;text-overflow:ellipsis;text-align:left;flex:auto;min-width:0;overflow:hidden}.yFwJXq_ddCaret{color:var(--dsw-alias-label-tertiary);flex:none}.yFwJXq_ddPanel{z-index:40;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-module-platform);border-radius:12px;width:100%;max-width:100%;max-height:340px;padding:4px;position:absolute;top:calc(100% + 4px);left:0;overflow:hidden auto;box-shadow:0 8px 24px #0000001f}.yFwJXq_ddItem,.yFwJXq_ddItemActive{cursor:pointer;border-radius:8px;align-items:center;gap:8px;min-width:0;padding:6px 8px;font-size:13px;line-height:20px;display:flex}.yFwJXq_ddItem:hover{background:var(--dsw-alias-bg-module-platform)}.yFwJXq_ddItemActive{background:var(--dsw-alias-bg-module-platform);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}.yFwJXq_ddItemMuted{color:var(--dsw-alias-label-tertiary);padding:6px 8px;font-size:13px}.yFwJXq_ddItem b,.yFwJXq_ddItemActive b,.yFwJXq_ddMeta{white-space:nowrap;text-overflow:ellipsis;min-width:0;overflow:hidden}.yFwJXq_ddX{width:22px;height:22px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:6px;flex:none;padding:0;font-size:12px;line-height:22px}.yFwJXq_ddX:hover{color:var(--dsw-alias-state-error)}.yFwJXq_ddStar:hover,.yFwJXq_ddStarOn{color:var(--dsw-alias-state-warn)}.yFwJXq_detailFrame{min-height:316px}.yFwJXq_modelField{align-items:center;gap:10px;margin-bottom:8px;display:flex}.yFwJXq_capInput{max-width:110px}.yFwJXq_checkLine{color:var(--dsw-alias-label-tertiary);align-items:center;gap:6px;font-size:12.5px;display:flex}.yFwJXq_modelList{border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;max-height:260px;margin:8px 0 12px;padding:0;list-style:none;overflow:auto}.yFwJXq_modelItem,.yFwJXq_modelItemActive{width:100%;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:none;align-items:center;gap:8px;padding:7px 10px;font-size:13px;line-height:20px;display:flex}.yFwJXq_modelItem:hover{background:var(--dsw-alias-bg-module-platform)}.yFwJXq_modelItemActive{background:var(--dsw-alias-bg-module-platform);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}.yFwJXq_modelItemMuted{color:var(--dsw-alias-label-tertiary);padding:7px 10px;font-size:13px}.yFwJXq_ddTag{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-module-platform);border-radius:8px;flex:none;padding:0 6px;font-size:11px;line-height:18px}.yFwJXq_ddStar,.yFwJXq_ddStarOn{width:22px;height:22px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:6px;flex:none;padding:0;font-size:13px;line-height:22px}.yFwJXq_ddStar:hover,.yFwJXq_ddStarOn{color:var(--dsw-alias-state-warn)}.yFwJXq_modelWarn{color:var(--dsw-alias-state-error);flex:none;font-size:11.5px}.yFwJXq_switchLine{align-items:center;display:flex}";
		const tagId = "dsh-dock-bridge/DockSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-dock-bridge";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var DockSection_module_css_default = {
			"formRow": "yFwJXq_formRow",
			"chipRow": "yFwJXq_chipRow",
			"cardTitle": "yFwJXq_cardTitle",
			"inlineFormActions": "yFwJXq_inlineFormActions",
			"link": "yFwJXq_link",
			"rowActions": "yFwJXq_rowActions",
			"grow": "yFwJXq_grow",
			"ddTag": "yFwJXq_ddTag",
			"formLabel": "yFwJXq_formLabel",
			"rowTitle": "yFwJXq_rowTitle",
			"rows": "yFwJXq_rows",
			"taskLine": "yFwJXq_taskLine",
			"providerRow": "yFwJXq_providerRow",
			"dotOk": "yFwJXq_dotOk",
			"selfBadge": "yFwJXq_selfBadge",
			"rowMeta": "yFwJXq_rowMeta",
			"cardActions": "yFwJXq_cardActions",
			"modelRow": "yFwJXq_modelRow",
			"providerName": "yFwJXq_providerName",
			"ddCaret": "yFwJXq_ddCaret",
			"ddStar": "yFwJXq_ddStar",
			"tabPanel": "yFwJXq_tabPanel",
			"ddPanel": "yFwJXq_ddPanel",
			"modelList": "yFwJXq_modelList",
			"ddItemActive": "yFwJXq_ddItemActive",
			"ddProv": "yFwJXq_ddProv",
			"guideTitle": "yFwJXq_guideTitle",
			"modelItem": "yFwJXq_modelItem",
			"taskFailed": "yFwJXq_taskFailed",
			"modelItemActive": "yFwJXq_modelItemActive",
			"narrow": "yFwJXq_narrow",
			"ddLabel": "yFwJXq_ddLabel",
			"dotMiss": "yFwJXq_dotMiss",
			"card": "yFwJXq_card",
			"intro": "yFwJXq_intro",
			"taskHead": "yFwJXq_taskHead",
			"footerNote": "yFwJXq_footerNote",
			"ddName": "yFwJXq_ddName",
			"modelField": "yFwJXq_modelField",
			"capInput": "yFwJXq_capInput",
			"tab": "yFwJXq_tab",
			"guideBody": "yFwJXq_guideBody",
			"outputTail": "yFwJXq_outputTail",
			"tabs": "yFwJXq_tabs",
			"title": "yFwJXq_title",
			"saveRow": "yFwJXq_saveRow",
			"rowHead": "yFwJXq_rowHead",
			"errorLine": "yFwJXq_errorLine",
			"taskInline": "yFwJXq_taskInline",
			"labelCol": "yFwJXq_labelCol",
			"section": "yFwJXq_section",
			"inlineForm": "yFwJXq_inlineForm",
			"ddTrigger": "yFwJXq_ddTrigger",
			"cellAction": "yFwJXq_cellAction",
			"empty": "yFwJXq_empty",
			"mono": "yFwJXq_mono",
			"riskList": "yFwJXq_riskList",
			"dshdock-spin": "yFwJXq_dshdock-spin",
			"ddItem": "yFwJXq_ddItem",
			"riskItem": "yFwJXq_riskItem",
			"hintIcon": "yFwJXq_hintIcon",
			"formGrid": "yFwJXq_formGrid",
			"cardBody": "yFwJXq_cardBody",
			"errorNote": "yFwJXq_errorNote",
			"logPath": "yFwJXq_logPath",
			"spin": "yFwJXq_spin",
			"ddMeta": "yFwJXq_ddMeta",
			"detailFrame": "yFwJXq_detailFrame",
			"table": "yFwJXq_table",
			"mutedCell": "yFwJXq_mutedCell",
			"checkboxRow": "yFwJXq_checkboxRow",
			"baseUrlNote": "yFwJXq_baseUrlNote",
			"providerActions": "yFwJXq_providerActions",
			"verSelect": "yFwJXq_verSelect",
			"row": "yFwJXq_row",
			"dot": "yFwJXq_dot",
			"rangeInput": "yFwJXq_rangeInput",
			"inlineFormRow": "yFwJXq_inlineFormRow",
			"subTitle": "yFwJXq_subTitle",
			"builtinBadge": "yFwJXq_builtinBadge",
			"checkLine": "yFwJXq_checkLine",
			"modelItemMuted": "yFwJXq_modelItemMuted",
			"stoppedDot": "yFwJXq_stoppedDot",
			"switchLine": "yFwJXq_switchLine",
			"ddItemMuted": "yFwJXq_ddItemMuted",
			"rowUrl": "yFwJXq_rowUrl",
			"ddX": "yFwJXq_ddX",
			"warnNote": "yFwJXq_warnNote",
			"ddStarOn": "yFwJXq_ddStarOn",
			"rowLine": "yFwJXq_rowLine",
			"cardHead": "yFwJXq_cardHead",
			"guide": "yFwJXq_guide",
			"modelWarn": "yFwJXq_modelWarn",
			"dd": "yFwJXq_dd",
			"statusLabel": "yFwJXq_statusLabel",
			"baseUrlRow": "yFwJXq_baseUrlRow"
		};
		//#endregion
		//#region src/client/parts.tsx
		/**
		* Shared presentation parts of the "DSH Dock" section: card frame, confirm
		* dialog (with the self-danger acknowledge step), error note, and inline
		* task progress. Pure props components over primitives and tokens.
		*/
		/** One settings card: uppercase head row with actions plus the body stack. */
		function SectionCard({ title, actions, children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: DockSection_module_css_default.card,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: DockSection_module_css_default.cardHead,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: DockSection_module_css_default.cardTitle,
						children: title
					}), actions !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: DockSection_module_css_default.cardActions,
						children: actions
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: DockSection_module_css_default.cardBody,
					children
				})]
			});
		}
		/** Confirmation dialog; `acknowledgeLabel` adds the self-danger gate. */
		function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, danger = false, acknowledgeLabel, busy = false, onConfirm, onClose }) {
			const [acknowledged, setAcknowledged] = (0, react.useState)(false);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open,
				onClose,
				title,
				closeLabel: cancelLabel,
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					disabled: busy,
					onClick: onClose,
					children: cancelLabel
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: danger ? "primary" : "primary",
					disabled: busy || acknowledgeLabel !== void 0 && !acknowledged,
					onClick: () => {
						setAcknowledged(false);
						onConfirm();
					},
					children: busy ? cancelLabel : confirmLabel
				})] }),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: DockSection_module_css_default.guideBody,
					children: body
				}), acknowledgeLabel !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: DockSection_module_css_default.checkboxRow,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						type: "checkbox",
						checked: acknowledged,
						onChange: (event) => setAcknowledged(event.target.checked)
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: acknowledgeLabel })]
				})]
			});
		}
		/** Red error note with the operation's message and optional output tail. */
		function ErrorNote({ title, detail, output }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: DockSection_module_css_default.errorNote,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.errorLine,
						children: title
					}),
					detail !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.errorLine,
						children: detail
					}),
					output !== void 0 && output.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: DockSection_module_css_default.outputTail,
						children: output.slice(-12).join("\n")
					})
				]
			});
		}
		/** Inline task progress: spinner + label + the freshest log line. */
		function TaskInline({ task, runningLabel, failedLabel }) {
			if (task === void 0) return null;
			const failed = task.status === "failed";
			const lastLine = task.lines !== void 0 && task.lines.length > 0 ? task.lines[task.lines.length - 1] : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: DockSection_module_css_default.taskInline,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: DockSection_module_css_default.taskHead,
					children: [
						task.status === "running" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconLoadingOutline16, {
							size: 14,
							className: DockSection_module_css_default.spin
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
							state: failed ? "error" : "done",
							size: 10,
							className: DockSection_module_css_default.dot
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: failed ? DockSection_module_css_default.taskFailed : void 0,
							children: failed ? failedLabel : runningLabel
						}),
						task.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: DockSection_module_css_default.taskLine,
							children: task.error
						})
					]
				}), lastLine !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: DockSection_module_css_default.taskLine,
					children: lastLine
				})]
			});
		}
		/** Guide card shown when the DSH Dock side of a feature is unusable. */
		function GuideCard({ title, body, icon }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: DockSection_module_css_default.guide,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: DockSection_module_css_default.guideTitle,
					children: [icon ?? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutline16, { size: 14 }), title]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: DockSection_module_css_default.guideBody,
					children: body
				})]
			});
		}
		//#endregion
		//#region src/client/ContainersCard.tsx
		/**
		* Containers card: one WebUI-shaped card per container (head with name and
		* status pill; meta with the inline version select, port chip, profile and
		* creation time; log path; url; flat actions plus the protect and auto-start
		* checkboxes), the new-container inline form, per-row task progress, and the
		* destructive confirmations (delete always, and the self-container strong path
		* for stop/update/delete with an acknowledge step).
		*/
		/** localStorage key for the last version used in a create (shared with the DSH Dock web UI). */
		const LAST_VERSION_KEY = "dshdock-last-version";
		/** Newest running (else failed) task across a row's kinds. */
		function rowTask(store, row) {
			const candidates = [
				store.taskFor("container-create", row.id),
				store.taskFor("container-start", row.id),
				store.taskFor("container-update", row.id)
			];
			return candidates.find((entry) => entry?.status === "running") ?? candidates.find((entry) => entry?.status === "failed");
		}
		/** The containers card body; rendered only when the service side is usable. */
		function ContainersCard({ t, store }) {
			const [creating, setCreating] = (0, react.useState)(false);
			const [confirmAction, setConfirmAction] = (0, react.useState)();
			const [portFor, setPortFor] = (0, react.useState)();
			const [portValue, setPortValue] = (0, react.useState)("");
			const [portNote, setPortNote] = (0, react.useState)();
			const [updateFor, setUpdateFor] = (0, react.useState)();
			const [updateVersion, setUpdateVersion] = (0, react.useState)("");
			const installedVersions = (store.versions?.versions ?? []).filter((entry) => entry.installed).map((entry) => entry.tag);
			const opError = store.opErrorFor([
				"create",
				"start:",
				"stop:",
				"update:",
				"delete:",
				"port:",
				"protect:",
				"autostart:"
			]);
			const submitCreate = async (input) => {
				try {
					await store.createContainer(input);
					localStorage.setItem(LAST_VERSION_KEY, input.version);
					setCreating(false);
				} catch {}
			};
			const submitPort = async () => {
				if (portFor === void 0) return;
				const port = Number(portValue);
				if (!Number.isInteger(port) || port < 1 || port > 65535) {
					setPortNote(t("containers.portPlaceholder"));
					return;
				}
				if (portFor.self) {
					setConfirmAction({
						kind: "port",
						row: portFor,
						port
					});
					return;
				}
				if (await store.setPort(portFor.id, port)) {
					setPortFor(void 0);
					setPortValue("");
				} else setPortNote(t("error.operationFailed"));
			};
			const confirmTitle = confirmAction === void 0 ? "" : confirmAction.kind === "update" ? `${t("containers.update")} · ${confirmAction.row.name}` : confirmAction.kind === "port" ? `${t("containers.port")} · ${confirmAction.row.name}` : confirmAction.kind === "stop" ? `${t("containers.stop")} · ${confirmAction.row.name}` : `${t("containers.delete")} · ${confirmAction.row.name}`;
			const confirmBody = confirmAction === void 0 ? "" : confirmAction.kind === "update" ? `${confirmAction.row.name} → ${confirmAction.version}` : confirmAction.kind === "port" ? t("containers.portSelfConfirm", {
				name: confirmAction.row.name,
				port: String(confirmAction.port)
			}) : confirmAction.kind === "stop" && confirmAction.row.self ? t("containers.selfDanger") : t("containers.deleteConfirm", { name: confirmAction.row.name });
			const selfDanger = confirmAction !== void 0 && confirmAction.kind !== "port" && confirmAction.row.self;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(SectionCard, {
				title: t("containers.title"),
				actions: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					size: "sm",
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, { size: 14 }),
					onClick: () => {
						setCreating((value) => !value);
					},
					children: t("containers.new")
				}),
				children: [
					creating && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreateForm, {
						t,
						versions: installedVersions,
						busy: store.isBusy("create"),
						onSubmit: (input) => {
							submitCreate(input);
						},
						onCancel: () => {
							setCreating(false);
						}
					}),
					store.containersError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, {
						title: store.containersError.title,
						detail: store.containersError.detail
					}),
					opError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, {
						title: opError.title,
						detail: opError.detail,
						output: opError.output
					}),
					store.containers.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.empty,
						children: t("containers.empty")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: DockSection_module_css_default.rows,
						children: [...store.containers].sort((a, b) => Number(b.self) - Number(a.self)).map((row) => {
							const task = rowTask(store, row);
							const rowBusy = store.pending("container-create", row.id) || store.pending("container-start", row.id) || store.pending("container-update", row.id) || store.isBusy(`stop:${row.id}`) || store.isBusy(`delete:${row.id}`);
							const creatingOrUpdating = store.pending("container-create", row.id) || store.pending("container-update", row.id);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: DockSection_module_css_default.row,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: DockSection_module_css_default.rowHead,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: DockSection_module_css_default.rowTitle,
												children: [row.name, row.devProtect === true ? " 🛡" : ""]
											}),
											row.self && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: DockSection_module_css_default.selfBadge,
												children: t("containers.self")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: DockSection_module_css_default.statusLabel,
												"data-status": row.status,
												children: t(`containers.status.${row.status}`)
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: DockSection_module_css_default.rowMeta,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
												className: DockSection_module_css_default.verSelect,
												value: row.version ?? "",
												disabled: rowBusy,
												"aria-label": t("containers.versionLabel"),
												onChange: (event) => {
													const next = event.target.value;
													if (next.length === 0 || next === row.version) return;
													setUpdateFor(row);
													setUpdateVersion(next);
												},
												children: [row.version === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "",
													children: "—"
												}), [.../* @__PURE__ */ new Set([...installedVersions, ...row.version === void 0 ? [] : [row.version]])].map((tag) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: tag,
													children: tag
												}, tag))]
											}),
											" · ",
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
												onClick: () => {
													setPortFor(row);
													setPortValue(row.port !== void 0 ? String(row.port) : "");
													setPortNote(void 0);
												},
												children: row.port !== void 0 ? t("containers.portChip", { port: String(row.port) }) : t("containers.portUnset")
											}),
											` · profile ${row.profile ?? ""} · ${t("containers.createdAt", { time: row.createdAt !== void 0 ? (/* @__PURE__ */ new Date(row.createdAt * 1e3)).toLocaleString() : "-" })}`
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: DockSection_module_css_default.logPath,
										children: [
											t("containers.logPath"),
											" ",
											row.logPath ?? `DSHDock_Data/containers/${row.id}/logs/host.log`
										]
									}),
									row.url !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: DockSection_module_css_default.rowUrl,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
											className: DockSection_module_css_default.link,
											href: row.url,
											target: "_blank",
											rel: "noreferrer",
											children: row.url
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: DockSection_module_css_default.rowActions,
										children: [
											creatingOrUpdating ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												size: "sm",
												disabled: true,
												children: store.pending("container-create", row.id) ? t("containers.creating") : t("containers.updating")
											}) : row.status === "running" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [row.url !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												size: "sm",
												variant: "primary",
												onClick: () => {
													window.open(row.url, "_blank", "noopener,noreferrer");
												},
												children: t("containers.open")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												size: "sm",
												icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconStopFill16, { size: 14 }),
												disabled: store.isBusy(`stop:${row.id}`),
												onClick: () => {
													if (row.self) setConfirmAction({
														kind: "stop",
														row
													});
													else store.stopContainer(row.id).catch(() => {});
												},
												children: t("containers.stop")
											})] }) : row.status === "starting" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												size: "sm",
												disabled: true,
												children: t("containers.starting")
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												size: "sm",
												variant: "primary",
												icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlayOutline16, { size: 14 }),
												disabled: store.isBusy(`start:${row.id}`),
												onClick: () => {
													store.startContainer(row.id).catch(() => {});
												},
												children: t("containers.start")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												size: "sm",
												disabled: store.isBusy(`delete:${row.id}`),
												onClick: () => {
													setConfirmAction({
														kind: "delete",
														row
													});
												},
												children: t("containers.delete")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
												className: DockSection_module_css_default.checkboxRow,
												title: t("containers.protectHint"),
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													type: "checkbox",
													checked: row.devProtect === true,
													disabled: store.isBusy(`protect:${row.id}`),
													onChange: () => {
														if (row.self) markProtectChoice(row.id);
														store.setProtect(row.id, row.devProtect !== true);
													}
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("containers.protect") })]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
												className: DockSection_module_css_default.checkboxRow,
												title: t("containers.autoStartHint"),
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													type: "checkbox",
													checked: row.autoStart === true,
													disabled: store.isBusy(`autostart:${row.id}`),
													onChange: () => {
														store.setAutoStart(row.id, row.autoStart !== true);
													}
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("containers.autoStart") })]
											})
										]
									}),
									task !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskInline, {
										task,
										runningLabel: store.pending("container-create", row.id) ? t("containers.creating") : store.pending("container-start", row.id) ? t("containers.starting") : t("containers.updating"),
										failedLabel: t("containers.taskFailed")
									})
								]
							}, row.id);
						})
					}),
					portFor !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: DockSection_module_css_default.inlineForm,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.inlineFormRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: DockSection_module_css_default.formLabel,
									children: [
										t("containers.port"),
										" · ",
										portFor.name
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									className: DockSection_module_css_default.narrow,
									value: portValue,
									placeholder: t("containers.portPlaceholder"),
									onChange: (event) => {
										setPortValue(event.target.value);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "primary",
									disabled: store.isBusy(`port:${portFor.id}`),
									onClick: () => {
										submitPort();
									},
									children: t("containers.confirm")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "outline",
									"aria-label": t("cancel"),
									onClick: () => {
										setPortFor(void 0);
										setPortNote(void 0);
									},
									children: "×"
								})
							]
						}), portNote !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: DockSection_module_css_default.footerNote,
							children: portNote
						})]
					}),
					updateFor !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: DockSection_module_css_default.inlineForm,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.inlineFormRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: DockSection_module_css_default.formLabel,
									children: [
										t("containers.update"),
										" · ",
										updateFor.name
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									className: DockSection_module_css_default.narrow,
									value: updateVersion,
									onChange: (event) => {
										setUpdateVersion(event.target.value);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: "—"
									}), installedVersions.map((tag) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: tag,
										children: tag
									}, tag))]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "primary",
									disabled: updateVersion.length === 0 || store.isBusy(`update:${updateFor.id}`),
									onClick: () => {
										const target = updateFor;
										const version = updateVersion;
										setUpdateFor(void 0);
										if (target.self) setConfirmAction({
											kind: "update",
											row: target,
											version
										});
										else store.updateContainer(target.id, version).catch(() => {});
									},
									children: t("containers.confirm")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "outline",
									"aria-label": t("cancel"),
									onClick: () => {
										setUpdateFor(void 0);
									},
									children: "×"
								})
							]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfirmDialog, {
						open: confirmAction !== void 0,
						title: confirmTitle,
						body: confirmBody,
						confirmLabel: confirmAction?.kind === "stop" ? t("containers.stop") : confirmAction?.kind === "delete" ? t("containers.delete") : t("containers.confirm"),
						cancelLabel: t("cancel"),
						danger: true,
						acknowledgeLabel: selfDanger ? t("containers.selfAcknowledge") : void 0,
						busy: confirmAction !== void 0 && store.isBusy(`${confirmAction.kind}:${confirmAction.row.id}`),
						onConfirm: () => {
							const action = confirmAction;
							setConfirmAction(void 0);
							if (action === void 0) return;
							if (action.kind === "stop") store.stopContainer(action.row.id, true).catch(() => {});
							else if (action.kind === "update") store.updateContainer(action.row.id, action.version, true).catch(() => {});
							else if (action.kind === "port") {
								const target = action.row;
								const port = action.port;
								(async () => {
									if (await store.setPort(target.id, port)) {
										setPortFor(void 0);
										setPortValue("");
										setPortNote(void 0);
									} else setPortNote(t("error.operationFailed"));
								})();
							} else store.deleteContainer(action.row.id, action.row.self).catch(() => {});
						},
						onClose: () => {
							setConfirmAction(void 0);
						}
					})
				]
			});
		}
		/** New-container inline form: name + version select (fed by the versions card). Profile is fixed to web. */
		function CreateForm({ t, versions, busy, onSubmit, onCancel }) {
			const [name, setName] = (0, react.useState)("");
			const [version, setVersion] = (0, react.useState)(() => {
				const last = localStorage.getItem(LAST_VERSION_KEY);
				return last !== null && versions.includes(last) ? last : versions[0] ?? "";
			});
			const valid = name.trim().length > 0 && version.length > 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: DockSection_module_css_default.inlineForm,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: DockSection_module_css_default.inlineFormRow,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
						className: DockSection_module_css_default.grow,
						value: name,
						placeholder: t("containers.namePlaceholder"),
						onChange: (event) => {
							setName(event.target.value);
						}
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
						className: DockSection_module_css_default.narrow,
						value: version,
						onChange: (event) => {
							setVersion(event.target.value);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "",
							children: t("containers.versionLabel")
						}), versions.map((tag) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: tag,
							children: tag
						}, tag))]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: DockSection_module_css_default.inlineFormActions,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						size: "sm",
						variant: "outline",
						"aria-label": t("cancel"),
						onClick: onCancel,
						children: "×"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						size: "sm",
						variant: "primary",
						disabled: !valid || busy,
						onClick: () => {
							onSubmit({
								name: name.trim(),
								version,
								profile: "web"
							});
						},
						children: busy ? t("containers.creating") : t("containers.create")
					})]
				})]
			});
		}
		//#endregion
		//#region src/client/ExternalCard.tsx
		/**
		* "外部 DSH 与配置" 卡片:上半部是**只读**的外部 DSH 检测(官方 ~/.dsh、npx/全局
		* 安装、源码检出、正在运行的实例),唯一可做的动作是「保存为配置」;下半部是配置
		* (自动保存开关、目录与保留份数、保存配置 → 生成自包含配置文件、配置文件列表 +
		* 从配置创建容器 / 删除)。检测只读:不改动任何外部实例,保存一律**只复制、绝不软链**。
		*/
		/** 字节数 → 与服务端恢复指南同口径的易读大小。 */
		function formatBytes(bytes) {
			if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
			if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
			return `${bytes} B`;
		}
		/** 配置原因 → 本机化文案(未知原因原样显示服务端的值)。 */
		function reasonLabel(t, reason) {
			switch (reason) {
				case "manual": return t("config.reason.manual");
				case "import": return t("config.reason.import");
				case "created": return t("config.reason.created");
				case "pre-delete": return t("config.reason.preDelete");
				case "pre-update": return t("config.reason.preUpdate");
				case void 0: return "-";
				default: return reason;
			}
		}
		/** 来源:优先显示打包时的原始 DSH_HOME,缺失时退回来源容器 id。 */
		function sourceLabel(item) {
			const source = item.source;
			if (source !== void 0 && source !== null && source.length > 0) return source;
			const containerId = item.containerId;
			if (containerId !== void 0 && containerId !== null && containerId.length > 0) return containerId;
			return "-";
		}
		/** 配置时间戳(秒)→ 本地时间;缺失时显示占位符。 */
		function formatWhen(t, createdAt) {
			return createdAt !== void 0 && createdAt !== null ? (/* @__PURE__ */ new Date(createdAt * 1e3)).toLocaleString() : t("config.unknownTime");
		}
		/** 配置名 → 合法的默认容器名(容器名只允许字母/数字/./_/-,≤64 字符)。 */
		function defaultContainerName(name) {
			const sanitized = name.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
			return `${(sanitized.length > 0 ? sanitized : "restored").slice(0, 56)}-new`;
		}
		/** 该容器 tab 的卡片主体:外部检测 + 配置两张卡。 */
		function ExternalCard({ t, store }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExternalDetectCard, {
				t,
				store
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfigCard, {
				t,
				store
			})] });
		}
		/** 外部 DSH 检测卡(只读;唯一动作 = 保存为配置)。 */
		function ExternalDetectCard({ t, store }) {
			const [saveTarget, setSaveTarget] = (0, react.useState)();
			const [acknowledged, setAcknowledged] = (0, react.useState)(false);
			const [saveNote, setSaveNote] = (0, react.useState)();
			const [checkPath, setCheckPath] = (0, react.useState)("");
			const [checked, setChecked] = (0, react.useState)();
			const [checkNote, setCheckNote] = (0, react.useState)();
			const external = store.external;
			const opError = store.opErrorFor(["external"]);
			const homes = external?.homes ?? [];
			const checkouts = external?.checkouts ?? [];
			const installed = external?.installed ?? [];
			const running = external?.running ?? [];
			const openSave = (target) => {
				setSaveNote(void 0);
				setAcknowledged(false);
				setSaveTarget(target);
			};
			const submitSave = async () => {
				const target = saveTarget;
				if (target === void 0) return;
				if (await store.saveExternalAsConfig({
					sourcePath: target.path,
					name: target.name,
					acknowledge: true
				})) {
					setSaveTarget(void 0);
					setAcknowledged(false);
					setSaveNote(t("external.savedConfig", { name: target.name.length > 0 ? target.name : target.path }));
				} else setSaveNote(t("error.operationFailed"));
			};
			const submitCheck = async () => {
				const path = checkPath.trim();
				if (path.length === 0) return;
				setCheckNote(void 0);
				const result = await store.checkExternal(path);
				setChecked(result);
				if (result === void 0) {
					setCheckNote(t("error.operationFailed"));
					return;
				}
				setCheckNote(result.isHome ? t("external.checkHome", { sessions: String(result.home.sessions) }) : result.isHarness ? t("external.checkHarness", { version: result.harness.version.length > 0 ? result.harness.version : "-" }) : t("external.checkNone"));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(SectionCard, {
				title: t("external.title"),
				actions: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					size: "sm",
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, { size: 14 }),
					onClick: () => {
						store.refreshExternal();
					},
					children: t("external.refresh")
				}),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.intro,
						children: t("external.intro")
					}),
					store.externalError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, {
						title: store.externalError.title,
						detail: store.externalError.detail
					}),
					opError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, {
						title: opError.title,
						detail: opError.detail,
						output: opError.output
					}),
					saveNote !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.footerNote,
						children: saveNote
					}),
					external !== void 0 && external.canDetectUsage !== true && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: DockSection_module_css_default.warnNote,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutline16, { size: 14 }), t("external.usageUnknown")]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
						className: DockSection_module_css_default.subTitle,
						children: t("external.homesTitle")
					}),
					homes.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.empty,
						children: t("external.homesEmpty")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: DockSection_module_css_default.rows,
						children: homes.map((home) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: DockSection_module_css_default.row,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: DockSection_module_css_default.rowHead,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: DockSection_module_css_default.rowTitle,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
											className: DockSection_module_css_default.mono,
											children: home.path
										})
									}), home.inUse && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, { children: t("external.inUse", { pid: home.pid !== null ? String(home.pid) : "-" }) })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: DockSection_module_css_default.rowMeta,
									children: [
										t("external.homeFacts", {
											sessions: String(home.sessions),
											files: String(home.files),
											size: formatBytes(home.bytes)
										}),
										home.hasCredentials ? ` · ${t("external.hasCredentials")}` : "",
										home.hasSettings ? ` · ${t("external.hasSettings")}` : ""
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: DockSection_module_css_default.rowActions,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										onClick: () => {
											openSave({
												path: home.path,
												name: home.path === external?.officialHome ? t("external.officialName") : "",
												inUse: home.inUse,
												hasCredentials: home.hasCredentials,
												sessions: home.sessions,
												bytes: home.bytes
											});
										},
										children: t("external.saveAsConfig")
									})
								})
							]
						}, home.path))
					}),
					external !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.footerNote,
						children: t("external.managedNote", {
							containers: String(external.containers.length),
							running: String(external.managedRunning)
						})
					}),
					external !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.footerNote,
						children: t("external.officialHomeNote", { path: external.officialHome })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
						className: DockSection_module_css_default.subTitle,
						children: t("external.versionsTitle")
					}),
					checkouts.length === 0 && installed.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.empty,
						children: t("external.versionsEmpty")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
						className: DockSection_module_css_default.rows,
						children: [checkouts.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: DockSection_module_css_default.row,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: DockSection_module_css_default.rowHead,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: DockSection_module_css_default.rowTitle,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
										className: DockSection_module_css_default.mono,
										children: item.path
									})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, { children: item.prebuilt ? t("external.prebuilt") : t("external.notPrebuilt") })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: DockSection_module_css_default.rowMeta,
								children: t("external.checkoutVersion", { version: item.version.length > 0 ? item.version : "-" })
							})]
						}, item.path)), installed.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							className: DockSection_module_css_default.row,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: DockSection_module_css_default.rowHead,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: DockSection_module_css_default.rowTitle,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
										className: DockSection_module_css_default.mono,
										children: item.path
									})
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, { children: t(`external.kind.${item.kind}`) })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: DockSection_module_css_default.rowMeta,
								children: t("external.installedVersion", { version: item.version.length > 0 ? item.version : "-" })
							})]
						}, `${item.kind}:${item.path}`))]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
						className: DockSection_module_css_default.subTitle,
						children: t("external.runningTitle")
					}),
					running.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.empty,
						children: t("external.runningEmpty")
					}),
					running.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
						className: DockSection_module_css_default.table,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("external.pid") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("external.port") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("external.home") })
						] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: running.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: item.pid }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: item.port !== null ? item.port : "-" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
								className: DockSection_module_css_default.mono,
								children: item.home ?? "-"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: DockSection_module_css_default.mutedCell,
								children: item.cmdline
							})] })
						] }, item.pid)) })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: DockSection_module_css_default.inlineForm,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: DockSection_module_css_default.inlineFormRow,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: DockSection_module_css_default.formLabel,
										children: t("external.checkLabel")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
										className: DockSection_module_css_default.grow,
										value: checkPath,
										placeholder: t("external.checkPlaceholder"),
										onChange: (event) => {
											setCheckPath(event.target.value);
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										variant: "primary",
										disabled: checkPath.trim().length === 0 || store.isBusy("externalCheck"),
										onClick: () => {
											submitCheck();
										},
										children: t("external.check")
									})
								]
							}),
							checkNote !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: DockSection_module_css_default.footerNote,
								children: checkNote
							}),
							checked?.isHome === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: DockSection_module_css_default.inlineFormActions,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									onClick: () => {
										openSave({
											path: checked.path,
											name: "",
											inUse: checked.usage.inUse,
											hasCredentials: checked.home.hasCredentials,
											sessions: checked.home.sessions,
											bytes: checked.home.bytes
										});
									},
									children: t("external.saveAsConfig")
								})
							})
						]
					}),
					saveTarget !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: DockSection_module_css_default.inlineForm,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: DockSection_module_css_default.inlineFormRow,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: DockSection_module_css_default.formLabel,
									children: [
										t("external.saveConfigTitle"),
										" · ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
											className: DockSection_module_css_default.mono,
											children: saveTarget.path
										})
									]
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: DockSection_module_css_default.rowMeta,
								children: t("external.saveConfigFacts", {
									sessions: String(saveTarget.sessions),
									size: formatBytes(saveTarget.bytes)
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
								className: DockSection_module_css_default.riskList,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
										className: DockSection_module_css_default.riskItem,
										children: t("external.riskCopy")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
										className: DockSection_module_css_default.riskItem,
										children: t("external.riskCredentials")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
										className: DockSection_module_css_default.riskItem,
										children: saveTarget.inUse ? t("external.riskInUse") : t("external.riskStop")
									}),
									saveTarget.hasCredentials && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
										className: DockSection_module_css_default.riskItem,
										children: t("external.riskPlaintext")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: DockSection_module_css_default.checkboxRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: acknowledged,
									onChange: (event) => {
										setAcknowledged(event.target.checked);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("external.acknowledge") })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: DockSection_module_css_default.inlineFormActions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "outline",
									onClick: () => {
										setSaveTarget(void 0);
										setAcknowledged(false);
									},
									children: t("cancel")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "primary",
									disabled: !acknowledged || store.isBusy("externalConfig"),
									onClick: () => {
										submitSave();
									},
									children: store.isBusy("externalConfig") ? t("external.savingConfig") : t("external.saveConfigConfirm")
								})]
							})
						]
					})
				]
			});
		}
		/** 配置卡:开关 / 目录 / 保留份数 + 保存配置(全部或某个容器)+ 配置文件列表。 */
		function ConfigCard({ t, store }) {
			const [enabled, setEnabled] = (0, react.useState)(false);
			const [dir, setDir] = (0, react.useState)("");
			const [keep, setKeep] = (0, react.useState)("10");
			const [saveFor, setSaveFor] = (0, react.useState)("");
			const [note, setNote] = (0, react.useState)();
			const [restoreFor, setRestoreFor] = (0, react.useState)();
			const [restoreName, setRestoreName] = (0, react.useState)("");
			const [restoreVersion, setRestoreVersion] = (0, react.useState)("");
			const [deleteFor, setDeleteFor] = (0, react.useState)();
			const opError = store.opErrorFor(["config"]);
			const items = store.configs?.items ?? [];
			const installedVersions = (store.versions?.versions ?? []).filter((entry) => entry.installed).map((entry) => entry.tag);
			(0, react.useEffect)(() => {
				if (store.settings !== void 0) {
					setEnabled(store.settings.configAutoSave === true);
					setDir(store.settings.configDir ?? "");
					setKeep(String(store.settings.configKeep ?? 10));
				}
			}, [store.settings]);
			const dirty = store.settings !== void 0 && (enabled !== (store.settings.configAutoSave === true) || dir.trim() !== (store.settings.configDir ?? "") || keep.trim() !== String(store.settings.configKeep ?? 10));
			const saveSettings = async () => {
				setNote(void 0);
				const saved = await store.saveConfigSettings({
					configAutoSave: enabled,
					configDir: dir.trim(),
					configKeep: Math.max(0, Number(keep) || 0)
				});
				setNote(saved ? t("settings.saved") : t("error.operationFailed"));
			};
			const saveNow = async () => {
				setNote(void 0);
				const done = await store.saveConfigNow(saveFor);
				setNote(done ? t("config.saveNowDone") : t("error.operationFailed"));
			};
			const openRestore = (row) => {
				setNote(void 0);
				setRestoreFor(row);
				setRestoreName(defaultContainerName(row.name));
				const rowVersion = row.version ?? "";
				setRestoreVersion(rowVersion.length > 0 && installedVersions.includes(rowVersion) ? rowVersion : installedVersions[0] ?? "");
			};
			const submitRestore = async () => {
				const row = restoreFor;
				if (row === void 0) return;
				const name = restoreName.trim();
				if (name.length === 0 || restoreVersion.length === 0) return;
				if (await store.createFromConfig(row.file, {
					name,
					version: restoreVersion,
					profile: row.profile
				})) {
					setRestoreFor(void 0);
					setNote(t("config.createStarted", { name }));
				} else setNote(t("error.operationFailed"));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(SectionCard, {
				title: t("config.cardTitle"),
				actions: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: DockSection_module_css_default.inlineFormRow,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
						className: DockSection_module_css_default.narrow,
						value: saveFor,
						onChange: (event) => {
							setSaveFor(event.target.value);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "",
							children: t("config.saveTargetAll")
						}), store.containers.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: row.id,
							children: row.name
						}, row.id))]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						size: "sm",
						variant: "primary",
						disabled: store.isBusy("configSave"),
						onClick: () => {
							saveNow();
						},
						children: store.isBusy("configSave") ? t("config.saveNowRunning") : t("config.saveNow")
					})]
				}),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.intro,
						children: t("config.intro")
					}),
					store.configsError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, {
						title: store.configsError.title,
						detail: store.configsError.detail
					}),
					store.settingsError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, {
						title: store.settingsError.title,
						detail: store.settingsError.detail
					}),
					opError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, {
						title: opError.title,
						detail: opError.detail,
						output: opError.output
					}),
					note !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.footerNote,
						children: note
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: DockSection_module_css_default.rowLine,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: DockSection_module_css_default.labelCol,
							children: t("config.enable")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: DockSection_module_css_default.checkboxRow,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: enabled,
								onChange: (event) => {
									setEnabled(event.target.checked);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("config.enableHint") })]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: DockSection_module_css_default.rowLine,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: DockSection_module_css_default.labelCol,
							children: t("config.dir")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
							className: DockSection_module_css_default.grow,
							value: dir,
							placeholder: store.configs?.dir ?? "",
							onChange: (event) => {
								setDir(event.target.value);
							}
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: DockSection_module_css_default.rowLine,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: DockSection_module_css_default.labelCol,
								children: t("config.keep")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								className: DockSection_module_css_default.narrow,
								value: keep,
								inputMode: "numeric",
								onChange: (event) => {
									setKeep(event.target.value);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: DockSection_module_css_default.footerNote,
								children: t("config.keepHint")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: DockSection_module_css_default.saveRow,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							variant: "primary",
							disabled: !dirty || store.isBusy("configSettings"),
							onClick: () => {
								saveSettings();
							},
							children: store.isBusy("configSettings") ? t("settings.saving") : t("settings.save")
						})
					}),
					items.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.empty,
						children: t("config.empty")
					}),
					items.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
						className: DockSection_module_css_default.table,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("config.file") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("config.source") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("config.version") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("config.sessions") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("config.size") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("config.createdAt") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("config.reason") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
								className: DockSection_module_css_default.cellAction,
								children: t("config.action")
							})
						] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: items.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: item.name }),
								item.file !== item.name && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: DockSection_module_css_default.mutedCell,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
										className: DockSection_module_css_default.mono,
										children: item.file
									})
								}),
								item.hasCredentials === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: DockSection_module_css_default.mutedCell,
									children: t("external.hasCredentials")
								}),
								item.valid !== true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: DockSection_module_css_default.mutedCell,
									children: item.error !== null && item.error !== void 0 ? `${t("config.invalid")}: ${item.error}` : t("config.invalid")
								})
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
								className: DockSection_module_css_default.mono,
								children: sourceLabel(item)
							}) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: item.version ?? "-" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: item.sessions ?? 0 }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: formatBytes(item.bytes) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: formatWhen(t, item.createdAt ?? item.modifiedAt) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", { children: [reasonLabel(t, item.reason), item.note !== void 0 && item.note.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: DockSection_module_css_default.mutedCell,
								children: item.note
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
								className: DockSection_module_css_default.cellAction,
								children: [item.valid === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									disabled: store.isBusy(`configRestore:${item.file}`),
									onClick: () => {
										openRestore(item);
									},
									children: t("config.create")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									disabled: store.isBusy(`configDelete:${item.file}`),
									onClick: () => {
										setDeleteFor(item);
									},
									children: t("config.delete")
								})]
							})
						] }, item.file)) })]
					}),
					restoreFor !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: DockSection_module_css_default.inlineForm,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.inlineFormRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: DockSection_module_css_default.formLabel,
									children: [
										t("config.create"),
										" · ",
										restoreFor.name
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									className: DockSection_module_css_default.grow,
									value: restoreName,
									placeholder: t("containers.namePlaceholder"),
									onChange: (event) => {
										setRestoreName(event.target.value.replace(/[^A-Za-z0-9._-]/g, ""));
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									className: DockSection_module_css_default.narrow,
									value: restoreVersion,
									onChange: (event) => {
										setRestoreVersion(event.target.value);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "",
										children: t("containers.versionLabel")
									}), installedVersions.map((tag) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: tag,
										children: tag
									}, tag))]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "primary",
									disabled: restoreName.trim().length === 0 || restoreVersion.length === 0 || store.isBusy(`configRestore:${restoreFor.file}`),
									onClick: () => {
										submitRestore();
									},
									children: t("containers.confirm")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "outline",
									"aria-label": t("cancel"),
									onClick: () => {
										setRestoreFor(void 0);
									},
									children: "×"
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: DockSection_module_css_default.footerNote,
							children: t("config.createHint")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfirmDialog, {
						open: deleteFor !== void 0,
						title: deleteFor !== void 0 ? `${t("config.delete")} · ${deleteFor.name}` : "",
						body: deleteFor !== void 0 ? t("config.deleteConfirm", { name: deleteFor.name }) : "",
						confirmLabel: t("config.delete"),
						cancelLabel: t("cancel"),
						danger: true,
						busy: deleteFor !== void 0 && store.isBusy(`configDelete:${deleteFor.file}`),
						onConfirm: () => {
							const row = deleteFor;
							setDeleteFor(void 0);
							if (row !== void 0) store.deleteConfig(row.file);
						},
						onClose: () => {
							setDeleteFor(void 0);
						}
					})
				]
			});
		}
		//#endregion
		//#region src/client/ModelConfigGroup.tsx
		/**
		* Model-config group of the settings card: the new-container initial config as a
		* flat list of MODELS. One row = one model plus its provider connection facts
		* (base URL / protocol / API key / provider name); container creation groups rows
		* that share a connection into one `llm-pi-ai.providers` entry automatically.
		* The picker is a custom dropdown whose every row carries a delete "✕", so a row
		* can be removed without reopening the menu, and the detail form below stays
		* mounted (only its bound data changes) so deleting never collapses the layout.
		* API keys are write-only: the server reports whether one is stored, never the value.
		*/
		/** Whole K/M only, so the text round-trips. */
		function capText(n) {
			if (typeof n !== "number") return "";
			if (n >= 1e6 && n % 1e6 === 0) return `${n / 1e6}M`;
			if (n >= 1e3 && n % 1e3 === 0) return `${n / 1e3}K`;
			return String(n);
		}
		/** `''` inherits, a number is the value, `null` is invalid. */
		function parseCap(text) {
			const trimmed = text.replace(/\s+/g, "");
			if (trimmed === "") return void 0;
			const match = trimmed.match(/^(\d+(?:\.\d+)?)([km])?$/i);
			if (match === null) return null;
			const value = Number(match[1]) * (match[2] === void 0 ? 1 : match[2].toLowerCase() === "k" ? 1e3 : 1e6);
			return Number.isInteger(value) && value > 0 ? value : null;
		}
		function draftOf(entry, defaultUid) {
			return {
				uid: entry.uid,
				id: entry.id,
				name: entry.name ?? "",
				baseURL: entry.baseURL ?? "",
				api: entry.api ?? "",
				apiKey: "",
				apiKeySet: entry.apiKeySet === true,
				apiKeyEnv: entry.apiKeyEnv ?? "",
				label: entry.label ?? "",
				ctx: capText(entry.contextWindow),
				max: capText(entry.maxTokens),
				isDefault: entry.uid === defaultUid
			};
		}
		const BLANK = {
			uid: "",
			id: "",
			name: "",
			baseURL: "",
			api: "",
			apiKey: "",
			apiKeySet: false,
			apiKeyEnv: "",
			label: "",
			ctx: "",
			max: "",
			isDefault: false
		};
		/** The model-config group body. */
		function ModelConfigGroup({ t, store }) {
			const view = store.modelConfig;
			const [draft, setDraft] = (0, react.useState)();
			const [open, setOpen] = (0, react.useState)(false);
			const [failure, setFailure] = (0, react.useState)();
			const [note, setNote] = (0, react.useState)();
			const [source, setSource] = (0, react.useState)("");
			const busy = store.isBusy("modelConfig");
			(0, react.useEffect)(() => {
				if (source === "" && store.containers.length > 0) setSource(store.containers[0].id);
			}, [source, store.containers]);
			(0, react.useEffect)(() => {
				if (view === void 0) return;
				if (draft !== void 0 && (draft.uid === "" || view.models.some((entry) => entry.uid === draft.uid))) return;
				if (view.models.length === 0) {
					setDraft({
						...BLANK,
						api: view.protocols[0] ?? ""
					});
					return;
				}
				const first = view.models.find((entry) => entry.uid === view.defaultUid) ?? view.models[0];
				setDraft(draftOf(first, view.defaultUid));
			}, [view, draft]);
			if (view === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
				className: DockSection_module_css_default.subTitle,
				children: t("settings.modelTitle")
			}), store.modelConfigError !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, {
				title: store.modelConfigError.title,
				detail: store.modelConfigError.detail
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: DockSection_module_css_default.mutedCell,
				children: t("settings.modelLoading")
			})] });
			const patch = (next) => {
				if (draft !== void 0) setDraft({
					...draft,
					...next
				});
			};
			const save = async () => {
				if (draft === void 0) return;
				const ctx = parseCap(draft.ctx);
				const max = parseCap(draft.max);
				if (draft.id.trim() === "") {
					setFailure(t("settings.modelIdRequired"));
					return;
				}
				if (ctx === null || max === null) {
					setFailure(t("settings.modelCapacityInvalid"));
					return;
				}
				const model = {
					id: draft.id.trim(),
					name: draft.name.trim(),
					api: draft.api,
					baseURL: draft.baseURL.trim(),
					label: draft.label.trim()
				};
				if (draft.apiKeyEnv !== "") model.apiKeyEnv = draft.apiKeyEnv;
				if (ctx !== void 0) model.contextWindow = ctx;
				if (max !== void 0) model.maxTokens = max;
				setFailure(void 0);
				const exact = view.models.find((entry) => entry.id === draft.id.trim() && (entry.api ?? "") === draft.api && (entry.baseURL ?? "") === draft.baseURL.trim());
				if (!await store.saveModel(exact === void 0 ? "new" : exact.uid, model, draft.apiKey)) {
					setFailure(t("error.operationFailed"));
					return;
				}
				setNote(t("settings.modelSaved", { model: draft.id.trim() }));
				setDraft(void 0);
			};
			const removeUid = async (uid, id) => {
				if (!await store.deleteModel(uid)) {
					setFailure(t("error.operationFailed"));
					return;
				}
				setNote(t("settings.modelDeleted", { model: id }));
				setDraft(void 0);
			};
			const importFrom = async () => {
				if (source === "") return;
				setFailure(void 0);
				if (!await store.importModelConfig(source)) {
					setFailure(t("error.operationFailed"));
					return;
				}
				setNote(t("settings.modelImported"));
				setDraft(void 0);
			};
			const currentLabel = draft === void 0 ? t("settings.modelPickNone") : draft.uid === "new" ? t("settings.modelNewDraft") : `${draft.uid === view.defaultUid ? "★ " : ""}${draft.id}${draft.label !== "" ? ` · ${draft.label}` : ""}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
					className: DockSection_module_css_default.subTitle,
					children: t("settings.modelTitle")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: DockSection_module_css_default.intro,
					children: t("settings.modelIntro")
				}),
				store.modelConfigError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, {
					title: store.modelConfigError.title,
					detail: store.modelConfigError.detail
				}),
				view.importedFrom != null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: DockSection_module_css_default.footerNote,
					children: view.importedFrom.migratedFromLegacy === true ? t("settings.modelMigrated") : t("settings.modelImportedFrom", { source: view.importedFrom.containerName ?? "?" })
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: DockSection_module_css_default.rowLine,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: DockSection_module_css_default.labelCol,
							children: t("settings.modelImportLabel")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							className: DockSection_module_css_default.verSelect,
							value: source,
							onChange: (event) => {
								setSource(event.target.value);
							},
							children: [store.containers.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "",
								children: t("settings.templateNoContainer")
							}), store.containers.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: entry.id,
								children: entry.name
							}, entry.id))]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							variant: "outline",
							disabled: busy || source === "",
							onClick: () => {
								importFrom();
							},
							children: t("settings.modelImport")
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: DockSection_module_css_default.rowLine,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: DockSection_module_css_default.dd,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: DockSection_module_css_default.ddTrigger,
							onClick: () => {
								setOpen(!open);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: DockSection_module_css_default.ddLabel,
								children: currentLabel
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: DockSection_module_css_default.ddCaret,
								children: "▾"
							})]
						}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.ddPanel,
							children: [
								view.models.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: DockSection_module_css_default.ddItemMuted,
									children: t("settings.modelEmpty")
								}),
								view.passthrough.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: DockSection_module_css_default.ddItem,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: DockSection_module_css_default.ddTag,
											children: t("settings.modelCatalogTag")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: item.route }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: DockSection_module_css_default.ddMeta,
											children: item.displayName
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: DockSection_module_css_default.grow }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: DockSection_module_css_default.ddX,
											title: t("settings.modelDelete"),
											onClick: () => {
												store.deletePassthrough(item.route).then(() => {
													setDraft(void 0);
												});
											},
											children: "✕"
										})
									]
								}, `pass-${item.route}`)),
								view.models.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: draft?.uid === entry.uid ? DockSection_module_css_default.ddItemActive : DockSection_module_css_default.ddItem,
									onClick: () => {
										setFailure(void 0);
										setDraft(draftOf(entry, view.defaultUid));
										setOpen(false);
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: entry.uid === view.defaultUid ? DockSection_module_css_default.ddStarOn : DockSection_module_css_default.ddStar,
											title: entry.uid === view.defaultUid ? t("settings.modelDefaultCurrent") : t("settings.modelDefault"),
											onClick: (event) => {
												event.stopPropagation();
												store.setDefaultModel(entry.uid).then(() => {
													setDraft(void 0);
												});
											},
											children: entry.uid === view.defaultUid ? "★" : "☆"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", {
											className: DockSection_module_css_default.ddName,
											children: entry.name !== void 0 && entry.name !== "" ? entry.name : entry.id
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: DockSection_module_css_default.ddProv,
											children: entry.providerLabel ?? ""
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: DockSection_module_css_default.grow }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: DockSection_module_css_default.ddX,
											title: t("settings.modelDelete"),
											onClick: (event) => {
												event.stopPropagation();
												removeUid(entry.uid, entry.id);
											},
											children: "✕"
										})
									]
								}, entry.uid))
							]
						})]
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: DockSection_module_css_default.detailFrame,
					children: draft === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.mutedCell,
						children: t("settings.modelDetailHint")
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.modelField,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: DockSection_module_css_default.labelCol,
								children: t("settings.modelIdField")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								className: DockSection_module_css_default.grow,
								value: draft.id,
								onChange: (event) => {
									patch({ id: event.target.value });
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.modelField,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: DockSection_module_css_default.labelCol,
								children: t("settings.modelNameField")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								className: DockSection_module_css_default.grow,
								value: draft.name,
								onChange: (event) => {
									patch({ name: event.target.value });
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.modelField,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: DockSection_module_css_default.labelCol,
								children: t("settings.modelBaseUrl")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								className: DockSection_module_css_default.grow,
								value: draft.baseURL,
								placeholder: "https://gateway.example/v1",
								onChange: (event) => {
									patch({ baseURL: event.target.value });
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.modelField,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: DockSection_module_css_default.labelCol,
								children: t("settings.modelApi")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
								className: DockSection_module_css_default.verSelect,
								value: draft.api,
								onChange: (event) => {
									patch({ api: event.target.value });
								},
								children: view.protocols.map((protocol) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: protocol,
									children: protocol
								}, protocol))
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.modelField,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: DockSection_module_css_default.labelCol,
								children: t("settings.modelKey")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								className: DockSection_module_css_default.grow,
								type: "password",
								value: draft.apiKey,
								placeholder: draft.apiKeySet ? t("settings.modelKeyStored") : t("settings.modelKeyPlaceholder"),
								onChange: (event) => {
									patch({ apiKey: event.target.value });
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.modelField,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: DockSection_module_css_default.labelCol,
								children: t("settings.modelProviderLabel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								className: DockSection_module_css_default.grow,
								value: draft.label,
								placeholder: t("settings.modelProviderLabelHint"),
								onChange: (event) => {
									patch({ label: event.target.value });
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.modelField,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: DockSection_module_css_default.labelCol,
									children: t("settings.modelCapacity")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									className: DockSection_module_css_default.capInput,
									value: draft.ctx,
									placeholder: "256K",
									onChange: (event) => {
										patch({ ctx: event.target.value });
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									className: DockSection_module_css_default.capInput,
									value: draft.max,
									placeholder: "32K",
									onChange: (event) => {
										patch({ max: event.target.value });
									}
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.rowLine,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: DockSection_module_css_default.mutedCell,
									children: draft.uid === "" ? "" : draft.uid === view.defaultUid ? t("settings.modelDefaultCurrent") : t("settings.modelDefaultHint")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: DockSection_module_css_default.grow }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "outline",
									disabled: busy || draft.uid === "",
									onClick: () => {
										removeUid(draft.uid, draft.id);
									},
									children: t("settings.modelDelete")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "primary",
									disabled: busy,
									onClick: () => {
										save();
									},
									children: busy ? t("settings.modelSaving") : t("settings.modelSave")
								})
							]
						}),
						failure !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: DockSection_module_css_default.errorNote,
							children: failure
						})
					] })
				}),
				view.providers.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: DockSection_module_css_default.footerNote,
					children: t("settings.modelProvidersNote", {
						count: String(view.providers.length),
						routes: view.providers.map((entry) => `${entry.route}(${entry.modelCount})`).join("、")
					})
				}),
				note !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: DockSection_module_css_default.footerNote,
					children: note
				})
			] });
		}
		//#endregion
		//#region src/client/SettingsCard.tsx
		/**
		* Settings card: mirrors the DSH Dock WebUI settings page — the network
		* group (proxy / mirrors / registry with shortcut chips, two-box port pool,
		* auto-open switch with hints, scope note, bottom save button) plus the
		* new-container initial-config template group. The bridge's own service
		* address (baseUrl) stays as a third group because it lives in the plugin's
		* activation row. When the service is unreachable the DSH-Dock groups
		* degrade away; the baseUrl group stays usable.
		*/
		const EMPTY = {
			proxy: "",
			githubMirror: "",
			npmRegistry: "",
			containerPortRange: "",
			autoOpenUiOnStart: true,
			skipFirstOpenPrompts: true,
			configAutoSave: false,
			configDir: "",
			configKeep: 10
		};
		/** Same shortcut chips the WebUI offers under the mirror fields. */
		const GH_PRESETS = [
			{
				label: "gh-proxy.com",
				value: "https://gh-proxy.com"
			},
			{
				label: "ghfast.top",
				value: "https://ghfast.top"
			},
			{
				label: "hk.gh-proxy.com",
				value: "https://hk.gh-proxy.com"
			}
		];
		const NPM_PRESETS = [
			{
				label: "npmmirror",
				value: "https://registry.npmmirror.com"
			},
			{
				label: "腾讯云",
				value: "https://mirrors.cloud.tencent.com/npm"
			},
			{
				label: "华为云",
				value: "https://mirrors.huaweicloud.com/repository/npm"
			},
			{
				label: "npm 官方",
				value: "https://registry.npmjs.org"
			}
		];
		/** Split a stored `start-end` range into its two boxes. */
		function splitRange(raw) {
			const match = raw.match(/^\s*([^-]*?)\s*(?:-\s*([^-]*?))?\s*$/);
			return [(match?.[1] ?? "").trim(), (match?.[2] ?? "").trim()];
		}
		/** Inline `?` hint: the label stays clean, the explanation rides a tooltip. */
		function Hint({ text }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label: text,
				side: "right",
				maxWidth: 320,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: DockSection_module_css_default.hintIcon,
					tabIndex: 0,
					role: "img",
					"aria-label": text,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconQuestionOutline14, { size: 12 })
				})
			});
		}
		/** The settings card body. */
		function SettingsCard({ t, store }) {
			const [draft, setDraft] = (0, react.useState)(EMPTY);
			const [portStart, setPortStart] = (0, react.useState)("");
			const [portEnd, setPortEnd] = (0, react.useState)("");
			const [baseUrl, setBaseUrlField] = (0, react.useState)("");
			const [savedNote, setSavedNote] = (0, react.useState)();
			const opError = store.opErrorFor([
				"settings",
				"baseUrl",
				"modelConfig"
			]);
			(0, react.useEffect)(() => {
				if (store.settings !== void 0) {
					setDraft(store.settings);
					const [start, end] = splitRange(store.settings.containerPortRange);
					setPortStart(start);
					setPortEnd(end);
				}
			}, [store.settings]);
			(0, react.useEffect)(() => {
				if (store.status !== void 0) setBaseUrlField(store.status.baseUrl);
			}, [store.status]);
			const dirty = store.settings !== void 0 && (draft.proxy !== store.settings.proxy || draft.githubMirror !== store.settings.githubMirror || draft.npmRegistry !== store.settings.npmRegistry || draft.containerPortRange !== store.settings.containerPortRange || draft.autoOpenUiOnStart !== store.settings.autoOpenUiOnStart);
			const setRange = (start, end) => {
				setPortStart(start);
				setPortEnd(end);
				const trimmedStart = start.trim();
				const trimmedEnd = end.trim();
				setDraft((previous) => ({
					...previous,
					containerPortRange: trimmedStart.length === 0 && trimmedEnd.length === 0 ? "" : `${trimmedStart}-${trimmedEnd}`
				}));
			};
			const save = async () => {
				setSavedNote(void 0);
				const saved = await store.saveSettings(draft);
				setSavedNote(saved ? t("settings.saved") : t("error.operationFailed"));
			};
			const saveBaseUrl = async () => {
				setSavedNote(void 0);
				const saved = await store.setBaseUrl(baseUrl.trim());
				setSavedNote(saved ? t("status.baseUrlSaved") : t("error.operationFailed"));
			};
			const chip = (label, apply) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
				onClick: apply,
				children: label
			}, label);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(SectionCard, {
				title: t("settings.title"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.intro,
						children: t("settings.intro")
					}),
					store.settingsError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, {
						title: store.settingsError.title,
						detail: store.settingsError.detail
					}),
					opError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, {
						title: opError.title,
						detail: opError.detail,
						output: opError.output
					}),
					savedNote !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.footerNote,
						children: savedNote
					}),
					store.serviceUp && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h4", {
							className: DockSection_module_css_default.subTitle,
							children: [
								t("settings.network"),
								" ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Hint, { text: t("settings.scopeNote") })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.rowLine,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: DockSection_module_css_default.labelCol,
								children: t("settings.proxy")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								className: DockSection_module_css_default.grow,
								value: draft.proxy,
								onChange: (event) => {
									setDraft({
										...draft,
										proxy: event.target.value
									});
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.rowLine,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: DockSection_module_css_default.labelCol }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: DockSection_module_css_default.chipRow,
								children: chip(t("settings.clear"), () => {
									setDraft({
										...draft,
										proxy: ""
									});
								})
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.rowLine,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: DockSection_module_css_default.labelCol,
								children: t("settings.githubMirror")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								className: DockSection_module_css_default.grow,
								value: draft.githubMirror,
								onChange: (event) => {
									setDraft({
										...draft,
										githubMirror: event.target.value
									});
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.rowLine,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: DockSection_module_css_default.labelCol }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: DockSection_module_css_default.chipRow,
								children: GH_PRESETS.map((preset) => chip(preset.label, () => {
									setDraft({
										...draft,
										githubMirror: preset.value
									});
								}))
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.rowLine,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: DockSection_module_css_default.labelCol,
								children: t("settings.npmRegistry")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								className: DockSection_module_css_default.grow,
								value: draft.npmRegistry,
								onChange: (event) => {
									setDraft({
										...draft,
										npmRegistry: event.target.value
									});
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.rowLine,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: DockSection_module_css_default.labelCol }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: DockSection_module_css_default.chipRow,
								children: NPM_PRESETS.map((preset) => chip(preset.label, () => {
									setDraft({
										...draft,
										npmRegistry: preset.value
									});
								}))
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.rowLine,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: DockSection_module_css_default.labelCol,
									children: [
										t("settings.portRange"),
										" ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Hint, { text: t("settings.portRangeHint") })
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									className: DockSection_module_css_default.rangeInput,
									value: portStart,
									inputMode: "numeric",
									placeholder: t("settings.portRangeStart"),
									onChange: (event) => {
										setRange(event.target.value, portEnd);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": "true",
									children: "-"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									className: DockSection_module_css_default.rangeInput,
									value: portEnd,
									inputMode: "numeric",
									placeholder: t("settings.portRangeEnd"),
									onChange: (event) => {
										setRange(portStart, event.target.value);
									}
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.rowLine,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: DockSection_module_css_default.labelCol,
								children: [
									t("settings.autoOpen"),
									" ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Hint, { text: t("settings.autoOpenHint") })
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
								className: DockSection_module_css_default.checkboxRow,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: draft.autoOpenUiOnStart,
									onChange: (event) => {
										setDraft({
											...draft,
											autoOpenUiOnStart: event.target.checked
										});
									}
								})
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.rowLine,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: DockSection_module_css_default.labelCol,
								children: [
									t("settings.skipPrompts"),
									" ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Hint, { text: t("settings.skipPromptsHint") })
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
								className: DockSection_module_css_default.switchLine,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: draft.skipFirstOpenPrompts,
									onChange: (event) => {
										setDraft({
											...draft,
											skipFirstOpenPrompts: event.target.checked
										});
									}
								})
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: DockSection_module_css_default.saveRow,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								size: "sm",
								variant: "primary",
								disabled: !dirty || store.isBusy("settings"),
								onClick: () => {
									save();
								},
								children: store.isBusy("settings") ? t("settings.saving") : t("settings.save")
							})
						})
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: DockSection_module_css_default.formGrid,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.formRow,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: DockSection_module_css_default.formLabel,
								children: [
									t("settings.baseUrl"),
									" ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Hint, { text: t("settings.baseUrlNote") })
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: DockSection_module_css_default.baseUrlRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									className: DockSection_module_css_default.grow,
									value: baseUrl,
									placeholder: t("status.baseUrlPlaceholder"),
									onChange: (event) => {
										setBaseUrlField(event.target.value);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "primary",
									disabled: store.isBusy("baseUrl") || baseUrl.trim().length === 0 || baseUrl === store.status?.baseUrl,
									onClick: () => {
										saveBaseUrl();
									},
									children: t("status.baseUrlSave")
								})]
							})]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelConfigGroup, {
						t,
						store
					})
				]
			});
		}
		//#endregion
		//#region src/client/VersionsCard.tsx
		/**
		* Versions card: the catalog as a WebUI-shaped table (version / status /
		* actions), install with inline progress under the status label, delete with
		* confirmation, and catalog refresh. Feeds the containers card's version
		* selects through the store.
		*/
		/** The versions card body; rendered only when the service side is usable. */
		function VersionsCard({ t, store }) {
			const [confirmTag, setConfirmTag] = (0, react.useState)();
			const rows = store.versions?.versions ?? [];
			const opError = store.opErrorFor(["install:", "versionDelete:"]);
			const cachedAt = store.versions?.fetchedAt !== void 0 ? t("versions.cachedAt", { time: (/* @__PURE__ */ new Date(store.versions.fetchedAt * 1e3)).toLocaleString() }) : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(SectionCard, {
				title: t("versions.title"),
				actions: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					size: "sm",
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, {
						size: 14,
						className: store.isBusy("versionsRefresh") ? DockSection_module_css_default.spin : void 0
					}),
					disabled: store.isBusy("versionsRefresh"),
					onClick: () => {
						store.refreshVersions(true).catch(() => {});
					},
					children: store.isBusy("versionsRefresh") ? t("versions.refreshing") : t("versions.refresh")
				}),
				children: [
					store.versionsError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, {
						title: store.versionsError.title,
						detail: store.versionsError.detail
					}),
					store.versions?.warning !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, { title: store.versions.warning }),
					opError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, {
						title: opError.title,
						detail: opError.detail,
						output: opError.output
					}),
					rows.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.empty,
						children: t("versions.empty")
					}),
					cachedAt !== void 0 && rows.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.footerNote,
						children: cachedAt
					}),
					rows.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
						className: DockSection_module_css_default.table,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("versions.version") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("versions.state") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
								className: DockSection_module_css_default.cellAction,
								children: t("versions.action")
							})
						] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: rows.map((row) => {
							const installing = store.pending("version-install", row.tag);
							const task = store.taskFor("version-install", row.tag);
							const lastLine = task?.lines !== void 0 && task.lines.length > 0 ? task.lines[task.lines.length - 1] : void 0;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: row.tag }) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: DockSection_module_css_default.statusLabel,
									"data-status": row.installed ? "running" : "stopped",
									children: row.installed ? t("versions.installed") : t("versions.remote")
								}), row.remote ? lastLine !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: DockSection_module_css_default.mutedCell,
									children: lastLine
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: DockSection_module_css_default.mutedCell,
									children: t("versions.remoteExtra")
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
									className: DockSection_module_css_default.cellAction,
									children: [!row.installed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										variant: "primary",
										icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutline16, { size: 14 }),
										disabled: installing,
										onClick: () => {
											store.installVersion(row.tag).catch(() => {});
										},
										children: installing ? t("versions.installing") : t("versions.install")
									}), row.installed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, { size: 14 }),
										disabled: store.isBusy(`versionDelete:${row.tag}`),
										onClick: () => {
											setConfirmTag(row.tag);
										},
										children: t("versions.delete")
									})]
								})
							] }, row.tag);
						}) })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfirmDialog, {
						open: confirmTag !== void 0,
						title: confirmTag !== void 0 ? `${t("versions.delete")} · ${confirmTag}` : "",
						body: confirmTag !== void 0 ? t("versions.confirmDelete", { tag: confirmTag }) : "",
						confirmLabel: t("versions.delete"),
						cancelLabel: t("cancel"),
						danger: true,
						busy: confirmTag !== void 0 && store.isBusy(`versionDelete:${confirmTag}`),
						onConfirm: () => {
							const tag = confirmTag;
							setConfirmTag(void 0);
							if (tag !== void 0) store.deleteVersion(tag).catch(() => {});
						},
						onClose: () => {
							setConfirmTag(void 0);
						}
					})
				]
			});
		}
		//#endregion
		//#region src/client/DockSection.tsx
		/**
		* The "DSH Dock" top-level settings section: environment banner plus the
		* tabbed cards (containers / versions / external & configs / settings). When
		* the service is unreachable or this DSH is independent, service-backed cards
		* degrade into the guide.
		*/
		/** The section root. */
		function DockSection(props) {
			const { call, t } = props;
			const store = useDock(call);
			const [activeTab, setActiveTab] = (0, react.useState)("containers");
			const status = store.status;
			const usable = store.serviceUp && status !== void 0;
			const degradeHint = store.bound ? t("status.serviceDownHint") : t("status.independentHint");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: DockSection_module_css_default.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: DockSection_module_css_default.title,
						children: t("title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.intro,
						children: t("intro")
					}),
					status === void 0 && store.statusError === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.intro,
						children: t("status.checking")
					}),
					store.statusError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GuideCard, {
						title: t("error.loadFailed"),
						body: store.statusError
					}),
					status !== void 0 && !usable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnusableGuide, {
						t,
						bound: store.bound,
						baseUrl: status.baseUrl,
						busy: store.isBusy("baseUrl"),
						onSave: (next) => {
							store.setBaseUrl(next);
						}
					}),
					status !== void 0 && usable && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: DockSection_module_css_default.intro,
						children: [
							t("status.okService", { baseUrl: status.baseUrl }),
							" · ",
							store.bound ? t("status.bound") : t("status.notBound")
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: DockSection_module_css_default.tabs,
						role: "tablist",
						"aria-label": t("title"),
						children: [
							"containers",
							"versions",
							"config",
							"settings"
						].map((tab) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							role: "tab",
							className: DockSection_module_css_default.tab,
							"data-active": activeTab === tab ? "true" : void 0,
							"aria-selected": activeTab === tab,
							onClick: () => {
								setActiveTab(tab);
							},
							children: t(`${tab}.title`)
						}, tab))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: DockSection_module_css_default.tabPanel,
						role: "tabpanel",
						children: [
							activeTab === "containers" && (usable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ContainersCard, {
								t,
								store
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DegradedCard, {
								title: t("containers.title"),
								hint: degradeHint
							})),
							activeTab === "versions" && (usable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VersionsCard, {
								t,
								store
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DegradedCard, {
								title: t("versions.title"),
								hint: degradeHint
							})),
							activeTab === "config" && (usable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExternalCard, {
								t,
								store
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DegradedCard, {
								title: t("config.title"),
								hint: degradeHint
							})),
							activeTab === "settings" && (usable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsCard, {
								t,
								store
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DegradedCard, {
								title: t("settings.title"),
								hint: degradeHint
							}))
						]
					})
				]
			});
		}
		/** Compact placeholder for a service-backed card while DSH Dock is unusable. */
		function DegradedCard({ title, hint }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SectionCard, {
				title,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: DockSection_module_css_default.guideBody,
					children: hint
				})
			});
		}
		/** The service-down/independent guide: explanation plus the address field. */
		function UnusableGuide({ t, bound, baseUrl, busy, onSave }) {
			const [value, setValue] = (0, react.useState)(baseUrl);
			const [adopted, setAdopted] = (0, react.useState)(baseUrl);
			if (adopted !== baseUrl) {
				setAdopted(baseUrl);
				setValue(baseUrl);
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: DockSection_module_css_default.guide,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: DockSection_module_css_default.guideTitle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutline16, { size: 14 }), bound ? t("status.serviceDown", { baseUrl }) : t("status.independent")]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.guideBody,
						children: bound ? t("status.serviceDownHint") : t("status.independentHint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: DockSection_module_css_default.baseUrlRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
							className: DockSection_module_css_default.grow,
							value,
							placeholder: t("status.baseUrlPlaceholder"),
							onChange: (event) => {
								setValue(event.target.value);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							variant: "primary",
							disabled: busy || value.trim().length === 0 || value === baseUrl,
							onClick: () => {
								onSave(value.trim());
							},
							children: t("status.baseUrlSave")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.baseUrlNote,
						children: t("status.baseUrlNote")
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		const zh = {
			"nav": "DSH Dock",
			"title": "DSH Dock",
			"intro": "容器 / 版本 / 设置 —— DSH Dock 的日常管理面板。",
			"status.checking": "正在检测 DSH Dock 服务…",
			"status.serviceDown": "DSH Dock 服务未运行({baseUrl})",
			"status.serviceDownHint": "在宿主机运行 `dshdock bg` 启动服务;或确认下方\"服务地址\"后重试。",
			"status.independent": "此 DSH 为独立实例(不经 DSH Dock 运行)",
			"status.independentHint": "在宿主机安装并启动 DSH Dock 后,在下方填写服务地址,容器与版本管理即可用。",
			"status.retry": "重新检测",
			"status.okService": "服务已连接:{baseUrl}",
			"status.bound": "本容器由 DSH Dock 管理。",
			"status.notBound": "本容器不是 DSH Dock 创建的(独立实例)。",
			"status.baseUrl": "服务地址",
			"status.baseUrlPlaceholder": "http://127.0.0.1:7940",
			"status.baseUrlSave": "保存地址",
			"status.baseUrlSaved": "已保存,分区将自动重载。",
			"status.baseUrlNote": "非默认端口或独立 DSH 场景下填写;保存在本容器的插件激活行里。",
			"containers.title": "容器",
			"containers.new": "新建容器",
			"containers.empty": "暂无容器",
			"containers.self": "本会话",
			"containers.open": "打开 UI",
			"containers.start": "启动",
			"containers.stop": "停止",
			"containers.update": "更新版本",
			"containers.port": "修改固定端口",
			"containers.portPlaceholder": "新端口(1024-65535)",
			"containers.portSelfConfirm": "容器 {name} 是当前会话所在容器:端口将在下次启动时变为 {port},当前书签地址随之失效。确认修改?",
			"containers.protectOn": "关闭开发保护",
			"containers.protectOff": "开启开发保护",
			"containers.delete": "删除",
			"containers.deleteConfirm": "删除容器 {name}?整个容器目录(含 profile 与会话数据)将被移除,不可恢复。",
			"containers.selfDanger": "该容器是当前会话所在容器(self):停止/更新/删除会杀死本会话。",
			"containers.selfAcknowledge": "我了解后果,继续(force)",
			"containers.confirm": "确认",
			"containers.versionLabel": "版本",
			"containers.namePlaceholder": "容器名(字母/数字/-/_)",
			"containers.create": "创建",
			"containers.creating": "创建中…",
			"containers.starting": "启动中…",
			"containers.updating": "更新中…",
			"containers.stopping": "正在停止…",
			"containers.deleting": "删除中…",
			"containers.portSaved": "端口已保存,下次启动生效。",
			"containers.portTitle": "点击修改固定端口(下次启动生效)",
			"containers.portChip": "端口 {port}",
			"containers.portUnset": "未分配",
			"containers.protect": "保护",
			"containers.protectHint": "开启后:服务关闭/重启时保留此容器进程(下次启动自动接管);删除需弹窗确认",
			"containers.autoStart": "自启",
			"containers.autoStartHint": "开启后:DSH Dock 服务启动时自动启动此容器(宿主机重启后也会自动拉起);进程仍存活的容器走自动接管,不会重复启动",
			"containers.createdAt": "创建于 {time}",
			"containers.logPath": "日志:",
			"containers.viewLog": "查看日志",
			"containers.taskFailed": "任务失败",
			"containers.status.running": "运行中",
			"containers.status.starting": "启动中",
			"containers.status.stopped": "已停止",
			"containers.status.failed": "失败",
			"versions.title": "版本",
			"versions.refresh": "刷新目录",
			"versions.refreshing": "刷新中…",
			"versions.version": "版本",
			"versions.state": "状态",
			"versions.action": "操作",
			"versions.installed": "已安装",
			"versions.remote": "未安装",
			"versions.remoteExtra": "不在远端目录中(可能已删除)",
			"versions.install": "安装",
			"versions.installing": "安装中…",
			"versions.delete": "删除",
			"versions.empty": "版本目录为空",
			"versions.cachedAt": "目录更新于 {time}",
			"versions.confirmDelete": "删除版本 {tag}?仅在本版本未被任何容器使用时允许。",
			"config.title": "外部与配置",
			"external.title": "外部 DSH 检测(只读)",
			"external.refresh": "重新检测",
			"external.intro": "检测 DSH Dock 之外已有的 DSH:官方 ~/.dsh、npx/全局安装、harness 源码检出,以及正在运行的实例。这里只检测并告知:不改动这些外部实例,也不建立任何链接;唯一可做的动作是把某份配置「保存为配置」。",
			"external.usageUnknown": "当前平台读不到进程的 DSH_HOME:无法自动判断某个配置是否正在被使用,提交前请自行确认源 DSH 已停止。",
			"external.homesTitle": "检测到的配置目录(DSH_HOME)",
			"external.homesEmpty": "未检测到外部 DSH(DSHBox 自己管理的容器不在此列)",
			"external.managedNote": "DSHBox 自己管理的 {containers} 个容器不计入外部 DSH;本次检测过滤掉 {running} 个由它们产生的 host 进程。",
			"external.inUse": "正在运行(pid {pid})",
			"external.homeFacts": "{sessions} 个会话 · {files} 个文件 · {size}",
			"external.saveConfigFacts": "{sessions} 个会话 · {size}",
			"external.hasCredentials": "含凭据文件",
			"external.hasSettings": "含 settings.yaml",
			"external.officialName": "官方 ~/.dsh",
			"external.officialHomeNote": "官方路径:{path}(不存在时不列出)",
			"external.saveAsConfig": "保存为配置",
			"external.versionsTitle": "检测到的 DSH 安装 / 检出",
			"external.versionsEmpty": "未检测到外部 DSH 安装或 harness 检出",
			"external.prebuilt": "已有构建产物",
			"external.notPrebuilt": "未构建",
			"external.checkoutVersion": "检出 {version}",
			"external.installedVersion": "版本 {version}",
			"external.kind.npx": "npx 缓存",
			"external.kind.global": "npm 全局",
			"external.runningTitle": "正在运行的 DSH 进程",
			"external.runningEmpty": "未检测到正在运行的 DSH 进程",
			"external.pid": "PID",
			"external.port": "端口",
			"external.home": "DSH_HOME",
			"external.checkLabel": "检测一个路径",
			"external.checkPlaceholder": "绝对路径,例如 /home/you/.dsh",
			"external.check": "检测",
			"external.checkHome": "这是一个 DSH 配置目录({sessions} 个会话),可保存为配置文件。",
			"external.checkHarness": "这是一份 harness 检出(版本 {version})。",
			"external.checkNone": "既不是 DSH 配置目录,也不是 harness 检出。",
			"external.saveConfigTitle": "保存为配置",
			"external.riskCopy": "只做复制:源目录不会被修改,复制完成后两边各自独立、互不影响;绝不使用软链。",
			"external.riskCredentials": "配置里可能含明文凭据(.credentials.yaml):配置文件请视为敏感数据,不要提交到公开仓库或分享。",
			"external.riskStop": "请先停止源 DSH:运行中复制可能得到写到一半的会话文件。",
			"external.riskInUse": "⚠️ 检测到源 DSH 仍在运行:保存到的可能只是某一刻的快照。",
			"external.riskPlaintext": "⚠️ 该目录含 .credentials.yaml(明文 API Key),保存成的配置文件里仍以 0600 权限保存。",
			"external.acknowledge": "我确认该 DSH 已停止,并了解以上风险",
			"external.saveConfigConfirm": "保存为配置",
			"external.savingConfig": "保存中…",
			"external.savedConfig": "已保存为配置文件:{name}",
			"config.cardTitle": "配置",
			"config.intro": "一次「保存配置」= 生成一个自包含的配置文件(<名字>-<版本>-<时间>.dshcfg,tar.gz,内含 meta.json 与 home/);恢复时只需要这个文件。配置文件是独立副本(只复制、不链接),即使卸载 DSH Dock,也能照配置目录内的指南手动恢复。",
			"config.enable": "自动保存",
			"config.enableHint": "开启后:创建容器、更新版本、删除容器前自动保存一份配置",
			"config.dir": "配置目录",
			"config.keep": "保留份数",
			"config.keepHint": "每个容器最多保留多少份(0 = 不清理);目录留空则用默认 DATA_ROOT/configs",
			"config.saveNow": "保存配置",
			"config.saveNowRunning": "保存中…",
			"config.saveNowDone": "已保存配置",
			"config.saveTargetAll": "全部容器",
			"config.empty": "暂无配置文件",
			"config.file": "文件名",
			"config.source": "来源",
			"config.version": "版本",
			"config.sessions": "会话",
			"config.size": "大小",
			"config.createdAt": "时间",
			"config.reason": "原因",
			"config.action": "操作",
			"config.invalid": "文件不可读",
			"config.create": "从配置创建",
			"config.delete": "删除",
			"config.deleteConfirm": "删除配置文件 {name}?文件会被移除,不可恢复(源容器不受影响)。",
			"config.createHint": "新建容器会复制这份配置(恢复 = 复制,不动配置文件本身);版本下拉复用「版本」分区的已安装版本。",
			"config.createStarted": "已开始从配置创建容器:{name}",
			"config.unknownTime": "未知",
			"config.reason.manual": "手动",
			"config.reason.import": "外部导入",
			"config.reason.created": "创建时自动",
			"config.reason.preDelete": "删除前自动",
			"config.reason.preUpdate": "更新前自动",
			"settings.title": "设置",
			"settings.intro": "DSH Dock 服务端设置(网络 / 端口池 / 启动行为)与本插件的服务地址。",
			"settings.network": "网络",
			"settings.proxy": "HTTP 代理",
			"settings.githubMirror": "GitHub 镜像",
			"settings.npmRegistry": "npm 镜像源",
			"settings.clear": "✕ 清空",
			"settings.portRange": "容器端口池",
			"settings.portRangeStart": "起始端口",
			"settings.portRangeEnd": "结束端口",
			"settings.portRangeHint": "容器创建时从此范围分配固定端口并持久化(每次启动不变;被其他进程占用则启动报错)",
			"settings.autoOpen": "启动后打开 UI",
			"settings.skipPrompts": "首开跳过弹窗",
			"settings.skipPromptsHint": "打开:新建容器时注入 ui-onboarding.welcomeNoticeVersion(不再弹测试版公告),并给没有密钥的提供方补占位密钥 local(不再弹 API Key 录入);关闭:两者都保留。",
			"settings.autoOpenHint": "点击「启动」后就绪时自动打开该容器的 DSH WebUI(由 DSH 上游弹出,带 token);关闭则不弹,自行点卡片上的链接",
			"settings.scopeNote": "作用范围:HTTP 代理 → GitHub API(版本目录);GitHub 镜像 → git 克隆(设置后克隆走镜像、不再用代理);npm 镜像源 → pnpm 在线装依赖。DSH host 进程始终运行在无代理环境(避免回环自检被代理劫持),不受以上配置影响。镜像快捷项已实测可用,失效时可手动填入其他前缀式镜像。",
			"settings.template": "新容器初始配置",
			"settings.templateLabel": "配置模板",
			"settings.templateNone": "未捕获",
			"settings.templateCaptured": "已捕获: {source} · {sections} 段 · API Key {keys}",
			"settings.templateNoKeys": "无",
			"settings.templateImport": "从容器导入",
			"settings.templateClear": "清除",
			"settings.templateNoContainer": "(无容器)",
			"settings.templateHint": "从已配置好的容器捕获配置(测试版公告已确认 / provider 定义 / 默认模型)与 API Key(凭据 refs,仅存本地 0600 文件,接口只回显键名不回显值);新建容器自动注入,首次打开不再出现「测试版公告」和「API Key 录入」弹窗。重复导入即更新模板;模板不随源容器后续改动自动更新。",
			"settings.templateClearConfirm": "清除已捕获的初始配置模板?之后新建容器不再自动注入配置。",
			"settings.modelTitle": "模型配置",
			"settings.modelIntro": "一行一个模型(连 API 地址 / 协议 / 密钥 / 提供方名称一起存)。新建容器时,连接信息相同的模型自动归纳成一个 llm-pi-ai.providers 条目,标注默认的那个写进 agent-default-model。API 密钥只存本机 0600 文件,接口只回显「已配置/缺失」。",
			"settings.modelLoading": "加载模型配置…",
			"settings.modelEmpty": "还没有配置任何提供方;可以手工添加,或从已配置好的容器一键导入。",
			"settings.modelProvider": "提供方",
			"settings.modelTemplates": "快速填充",
			"settings.modelId": "Provider ID",
			"settings.modelKey": "API 密钥",
			"settings.modelKeyStored": "已配置——输入新值可替换,留空保持不变",
			"settings.modelKeyPlaceholder": "输入 API 密钥,或留空走提供方原生鉴权",
			"settings.modelDisplayName": "显示名称",
			"settings.modelApi": "API 协议",
			"settings.modelApiUnset": "未选择(用目录默认)",
			"settings.modelBaseUrl": "API 地址",
			"settings.modelCatalog": "模型目录",
			"settings.modelCatalogHint": "留空 = 使用目录内置模型",
			"settings.modelFetch": "获取可用模型",
			"settings.modelFetched": "已添加 {count} 个模型",
			"settings.modelAddRow": "添加模型",
			"settings.modelSave": "保存",
			"settings.modelSaving": "保存中…",
			"settings.modelSaved": "已保存 {model}",
			"settings.modelEdit": "编辑",
			"settings.modelDelete": "删除",
			"settings.modelAdd": "添加提供方",
			"settings.modelAddCustom": "添加自定义提供方",
			"settings.modelImport": "从容器导入",
			"settings.modelImportLabel": "导入来源",
			"settings.modelImported": "导入完成",
			"settings.modelImportedFrom": "导入自 {source}",
			"settings.modelMigrated": "已由旧版模板迁移",
			"settings.modelDefault": "默认模型",
			"settings.modelKeyOk": "API 密钥已配置",
			"settings.modelKeyMissing": "API 密钥缺失",
			"settings.modelKeyLocal": "本地无密钥(可填 local)",
			"settings.modelCatalogTag": "目录",
			"settings.modelNewTag": "新建",
			"settings.modelCount": "{count} 个模型",
			"settings.modelCatalogEndpoint": "目录默认端点",
			"settings.modelPick": "选择模型",
			"settings.modelPickNone": "(未选择模型)",
			"settings.modelNewDraft": "(新模型,未保存)",
			"settings.modelDefaultCurrent": "★ 当前默认模型",
			"settings.modelDefaultHint": "用下拉里每项最前方的 ☆ 设为默认",
			"settings.modelNew": "新增",
			"settings.modelDetailHint": "从上面的下拉列表选一个模型来查看/修改,或点「新增」。",
			"settings.modelProviderLabel": "提供方名称",
			"settings.modelProviderLabelHint": "同名的模型会归到同一个提供方(留空则按地址主机名)",
			"settings.modelCapacity": "上下文 / 最大输出",
			"settings.modelDeleted": "已删除 {model}",
			"settings.modelIdRequired": "模型 ID 不能为空",
			"settings.modelCapacityInvalid": "容量需为数字,可加 K 或 M 后缀",
			"settings.modelFetchedNone": "该提供方没有列出任何模型",
			"settings.modelProvidersNote": "将写入 {count} 个提供方:{routes}",
			"settings.modelIdField": "模型 ID",
			"settings.modelNameField": "显示名称",
			"settings.baseUrl": "服务地址(baseUrl)",
			"settings.save": "保存设置",
			"settings.saving": "保存中…",
			"settings.saved": "已保存",
			"settings.baseUrlNote": "仅影响本容器到 DSH Dock 的连接;保存在本容器的插件激活行里。",
			"task.recent": "最近输出",
			"task.running": "进行中…",
			"task.done": "已完成",
			"task.failed": "失败",
			"error.loadFailed": "加载失败",
			"error.operationFailed": "操作失败",
			"error.retry": "重试",
			"error.details": "详情"
		};
		/** English dictionary: identical key set, checked at the typed register call. */
		const en = {
			"nav": "DSH Dock",
			"title": "DSH Dock",
			"intro": "Containers / versions / settings — the everyday panel for DSH Dock.",
			"status.checking": "Checking the DSH Dock service…",
			"status.serviceDown": "DSH Dock service is not running ({baseUrl})",
			"status.serviceDownHint": "Run `dshdock bg` on the host machine to start it, or verify the service address below and retry.",
			"status.independent": "This DSH is an independent instance (not managed by DSH Dock)",
			"status.independentHint": "After installing and starting DSH Dock on the host machine, fill in the service address below and container/version management becomes available.",
			"status.retry": "Check again",
			"status.okService": "Service connected: {baseUrl}",
			"status.bound": "This container is managed by DSH Dock.",
			"status.notBound": "This container was not created by DSH Dock (independent instance).",
			"status.baseUrl": "Service address",
			"status.baseUrlPlaceholder": "http://127.0.0.1:7940",
			"status.baseUrlSave": "Save address",
			"status.baseUrlSaved": "Saved; the section reloads automatically.",
			"status.baseUrlNote": "Fill this in for a non-default port or an independent DSH; stored in this container's activation row.",
			"containers.title": "Containers",
			"containers.new": "New container",
			"containers.empty": "No containers yet",
			"containers.self": "This session",
			"containers.open": "Open UI",
			"containers.start": "Start",
			"containers.stop": "Stop",
			"containers.update": "Update version",
			"containers.port": "Change fixed port",
			"containers.portPlaceholder": "New port (1024-65535)",
			"containers.portSelfConfirm": "Container {name} hosts the current session: its port becomes {port} on next start and the current bookmarked address stops working. Proceed?",
			"containers.protectOn": "Disable dev protect",
			"containers.protectOff": "Enable dev protect",
			"containers.delete": "Delete",
			"containers.deleteConfirm": "Delete container {name}? The whole container directory (profile and sessions included) is removed and cannot be recovered.",
			"containers.selfDanger": "This container hosts the current session (self): stop/update/delete would kill this session.",
			"containers.selfAcknowledge": "I understand the consequence; continue (force)",
			"containers.confirm": "Confirm",
			"containers.versionLabel": "Version",
			"containers.namePlaceholder": "Container name (letters/digits/-/_)",
			"containers.create": "Create",
			"containers.creating": "Creating…",
			"containers.starting": "Starting…",
			"containers.updating": "Updating…",
			"containers.stopping": "Stopping…",
			"containers.deleting": "Deleting…",
			"containers.portSaved": "Port saved; takes effect on next start.",
			"containers.portTitle": "Click to change the fixed port (takes effect on next start)",
			"containers.portChip": "Port {port}",
			"containers.portUnset": "unassigned",
			"containers.protect": "Protect",
			"containers.protectHint": "While on: the container process survives service shutdown/restart (reattached on next start); deletion asks for confirmation",
			"containers.autoStart": "Auto-start",
			"containers.autoStartHint": "While on: this container starts automatically whenever the DSH Dock service starts (host reboots included). Containers whose process is still alive are reattached instead, so they never start twice",
			"containers.createdAt": "Created at {time}",
			"containers.logPath": "Log:",
			"containers.viewLog": "View log",
			"containers.taskFailed": "Task failed",
			"containers.status.running": "Running",
			"containers.status.starting": "Starting",
			"containers.status.stopped": "Stopped",
			"containers.status.failed": "Failed",
			"versions.title": "Versions",
			"versions.refresh": "Refresh catalog",
			"versions.refreshing": "Refreshing…",
			"versions.version": "Version",
			"versions.state": "Status",
			"versions.action": "Actions",
			"versions.installed": "Installed",
			"versions.remote": "Not installed",
			"versions.remoteExtra": "Not in the remote catalog (possibly removed)",
			"versions.install": "Install",
			"versions.installing": "Installing…",
			"versions.delete": "Delete",
			"versions.empty": "The version catalog is empty",
			"versions.cachedAt": "Catalog updated at {time}",
			"versions.confirmDelete": "Delete version {tag}? Only allowed while no container uses it.",
			"config.title": "External & configs",
			"external.title": "External DSH detection (read-only)",
			"external.refresh": "Detect again",
			"external.intro": "Detects DSH instances that already exist outside DSH Dock: the official ~/.dsh, npx/global installs, harness source checkouts, and running instances. This only detects and informs — external instances are never modified and no link is ever created; the single available action is \"Save as config\", which packs an existing DSH_HOME into one self-contained configuration file.",
			"external.usageUnknown": "This platform cannot read a process's DSH_HOME, so it cannot tell whether a configuration is in use; confirm the source DSH is stopped before submitting.",
			"external.homesTitle": "Detected config directories (DSH_HOME)",
			"external.homesEmpty": "No external DSH detected (containers managed by DSHBox itself are not included)",
			"external.managedNote": "The {containers} containers managed by DSHBox itself are not counted as external DSH; this detection filtered out {running} host processes they produced.",
			"external.inUse": "Running (pid {pid})",
			"external.homeFacts": "{sessions} sessions · {files} files · {size}",
			"external.saveConfigFacts": "{sessions} sessions · {size}",
			"external.hasCredentials": "has credentials file",
			"external.hasSettings": "has settings.yaml",
			"external.officialName": "official ~/.dsh",
			"external.officialHomeNote": "Official path: {path} (not listed while it does not exist)",
			"external.saveAsConfig": "Save as config",
			"external.versionsTitle": "Detected DSH installs / checkouts",
			"external.versionsEmpty": "No external DSH install or harness checkout detected",
			"external.prebuilt": "prebuilt",
			"external.notPrebuilt": "not built",
			"external.checkoutVersion": "checkout {version}",
			"external.installedVersion": "version {version}",
			"external.kind.npx": "npx cache",
			"external.kind.global": "npm global",
			"external.runningTitle": "Running DSH processes",
			"external.runningEmpty": "No running DSH process detected",
			"external.pid": "PID",
			"external.port": "Port",
			"external.home": "DSH_HOME",
			"external.checkLabel": "Check a path",
			"external.checkPlaceholder": "Absolute path, e.g. /home/you/.dsh",
			"external.check": "Check",
			"external.checkHome": "This is a DSH config directory ({sessions} sessions); it can be saved as a configuration file.",
			"external.checkHarness": "This is a harness checkout (version {version}).",
			"external.checkNone": "Neither a DSH config directory nor a harness checkout.",
			"external.saveConfigTitle": "Save as config",
			"external.riskCopy": "Copy only: the source directory is never modified, and both sides stay independent afterwards; symlinks are never used.",
			"external.riskCredentials": "The config may hold plaintext credentials (.credentials.yaml): treat the configuration file as sensitive and never commit or share it.",
			"external.riskStop": "Stop the source DSH first: copying while it runs may capture half-written session files.",
			"external.riskInUse": "⚠️ The source DSH is still running: what gets saved may only be a snapshot of one moment.",
			"external.riskPlaintext": "⚠️ This directory holds .credentials.yaml (plaintext API keys); the configuration file keeps them under mode 0600.",
			"external.acknowledge": "I confirm that DSH is stopped and I understand the risks above",
			"external.saveConfigConfirm": "Save as config",
			"external.savingConfig": "Saving…",
			"external.savedConfig": "Saved as a configuration file: {name}",
			"config.cardTitle": "Configurations",
			"config.intro": "One \"Save config\" creates one self-contained configuration file (<name>-<version>-<time>.dshcfg, a tar.gz holding meta.json and home/); restoring needs nothing but that file. Every configuration file is an independent copy (copy only, never a link), so it can still be restored by hand from the guide in the config directory even after DSH Dock is uninstalled.",
			"config.enable": "Auto-save",
			"config.enableHint": "While on: save a configuration before creating a container, updating a version, or deleting a container",
			"config.dir": "Config directory",
			"config.keep": "Keep count",
			"config.keepHint": "Configuration files kept per container (0 = never prune); an empty directory means the default DATA_ROOT/configs",
			"config.saveNow": "Save config",
			"config.saveNowRunning": "Saving…",
			"config.saveNowDone": "Configuration saved",
			"config.saveTargetAll": "All containers",
			"config.empty": "No configuration files yet",
			"config.file": "File",
			"config.source": "Source",
			"config.version": "Version",
			"config.sessions": "Sessions",
			"config.size": "Size",
			"config.createdAt": "Time",
			"config.reason": "Reason",
			"config.action": "Actions",
			"config.invalid": "file unreadable",
			"config.create": "Create from config",
			"config.delete": "Delete",
			"config.deleteConfirm": "Delete configuration file {name}? The file is removed and cannot be recovered (the source container is unaffected).",
			"config.createHint": "The new container copies this configuration (restoring = copying; the file itself is untouched); the version list reuses the installed versions from the Versions tab.",
			"config.createStarted": "Creating a container from the configuration: {name}",
			"config.unknownTime": "unknown",
			"config.reason.manual": "manual",
			"config.reason.import": "external import",
			"config.reason.created": "auto on create",
			"config.reason.preDelete": "auto before delete",
			"config.reason.preUpdate": "auto before update",
			"settings.title": "Settings",
			"settings.intro": "DSH Dock service settings (network / port pool / startup behavior) and this plugin's service address.",
			"settings.network": "Network",
			"settings.proxy": "HTTP proxy",
			"settings.githubMirror": "GitHub mirror",
			"settings.npmRegistry": "npm registry mirror",
			"settings.clear": "✕ Clear",
			"settings.portRange": "Container port pool",
			"settings.portRangeStart": "Start port",
			"settings.portRangeEnd": "End port",
			"settings.portRangeHint": "New containers are assigned a fixed port from this range and persist it (unchanged across restarts; startup fails if another process occupies it)",
			"settings.autoOpen": "Open UI after start",
			"settings.skipPrompts": "Skip first-open prompts",
			"settings.skipPromptsHint": "On: new containers get ui-onboarding.welcomeNoticeVersion injected (no beta notice) and keyless providers get the placeholder key local (no API-key prompt). Off: both prompts stay.",
			"settings.autoOpenHint": "Automatically opens the container's DSH WebUI when it becomes ready after clicking Start (popped by the DSH upstream, token included); with it off, open the link on the card yourself",
			"settings.scopeNote": "Scope: HTTP proxy → GitHub API (version catalog); GitHub mirror → git clone (clones go through the mirror once set, bypassing the proxy); npm registry → pnpm online installs. DSH host processes always run proxy-free (so loopback health checks cannot be hijacked by a proxy) and are unaffected by the above. The mirror shortcuts are verified working; if one dies, fill in another prefix-style mirror manually.",
			"settings.template": "New-container initial config",
			"settings.templateLabel": "Config template",
			"settings.templateNone": "Not captured",
			"settings.templateCaptured": "Captured: {source} · {sections} sections · API keys {keys}",
			"settings.templateNoKeys": "none",
			"settings.templateImport": "Import from container",
			"settings.templateClear": "Clear",
			"settings.templateNoContainer": "(no containers)",
			"settings.templateHint": "Captures the config (beta-notice acknowledgement / provider definitions / default model) and API keys (credential refs, local 0600 file only, the API echoes key names but never values) from a configured container; new containers get it injected automatically so the beta-notice and API-key prompts never appear on first open. Re-importing updates the template; the template does not track later changes of the source container.",
			"settings.templateClearConfirm": "Clear the captured initial-config template? New containers will no longer get automatic config injection.",
			"settings.modelTitle": "Model configuration",
			"settings.modelIntro": "One row per model, carrying its API base URL / protocol / key / provider name. At container creation rows sharing a connection collapse into one llm-pi-ai.providers entry, and the starred row becomes agent-default-model. API keys live only in a local 0600 file; the API echoes configured/missing, never the value.",
			"settings.modelLoading": "Loading model configuration…",
			"settings.modelEmpty": "No provider configured yet; add one by hand or import from a configured container.",
			"settings.modelProvider": "Provider",
			"settings.modelTemplates": "Templates",
			"settings.modelId": "Provider ID",
			"settings.modelKey": "API key",
			"settings.modelKeyStored": "Configured — enter a new value to replace, leave empty to keep",
			"settings.modelKeyPlaceholder": "Enter an API key, or leave blank for the provider's native auth",
			"settings.modelDisplayName": "Display name",
			"settings.modelApi": "API protocol",
			"settings.modelApiUnset": "Not selected (catalog default)",
			"settings.modelBaseUrl": "Base URL",
			"settings.modelCatalog": "Models",
			"settings.modelCatalogHint": "Empty = use the catalog defaults",
			"settings.modelFetch": "Fetch available models",
			"settings.modelFetched": "Added {count} models",
			"settings.modelAddRow": "Add model",
			"settings.modelSave": "Save",
			"settings.modelSaving": "Saving…",
			"settings.modelSaved": "Saved {model}",
			"settings.modelEdit": "Edit",
			"settings.modelDelete": "Delete",
			"settings.modelAdd": "Add provider",
			"settings.modelAddCustom": "Add a custom provider",
			"settings.modelImport": "Import from container",
			"settings.modelImportLabel": "Import source",
			"settings.modelImported": "Import complete",
			"settings.modelImportedFrom": "Imported from {source}",
			"settings.modelMigrated": "Migrated from the legacy template",
			"settings.modelDefault": "Default model",
			"settings.modelKeyOk": "API key configured",
			"settings.modelKeyMissing": "API key missing",
			"settings.modelKeyLocal": "No local key (use local)",
			"settings.modelCatalogTag": "Catalog",
			"settings.modelNewTag": "New",
			"settings.modelCount": "{count} models",
			"settings.modelCatalogEndpoint": "catalog endpoint",
			"settings.modelPick": "Choose a model",
			"settings.modelPickNone": "(no model selected)",
			"settings.modelNewDraft": "(new model, unsaved)",
			"settings.modelDefaultCurrent": "★ Current default model",
			"settings.modelDefaultHint": "Use the ☆ at the front of a dropdown row to make it the default",
			"settings.modelNew": "New",
			"settings.modelDetailHint": "Pick a model above to view/edit it, or press New.",
			"settings.modelProviderLabel": "Provider name",
			"settings.modelProviderLabelHint": "Models sharing this name group into one provider (empty = host name)",
			"settings.modelCapacity": "Context / max output",
			"settings.modelDeleted": "Deleted {model}",
			"settings.modelIdRequired": "A model ID is required",
			"settings.modelCapacityInvalid": "A capacity must be a number, optionally suffixed K or M",
			"settings.modelFetchedNone": "The provider listed no models",
			"settings.modelProvidersNote": "Writes {count} providers: {routes}",
			"settings.modelIdField": "Model ID",
			"settings.modelNameField": "Display name",
			"settings.baseUrl": "Service address (baseUrl)",
			"settings.save": "Save settings",
			"settings.saving": "Saving…",
			"settings.saved": "Saved",
			"settings.baseUrlNote": "Affects only this container's connection to DSH Dock; stored in this container's activation row.",
			"task.recent": "Recent output",
			"task.running": "In progress…",
			"task.done": "Done",
			"task.failed": "Failed",
			"error.loadFailed": "Load failed",
			"error.operationFailed": "Operation failed",
			"error.retry": "Retry",
			"error.details": "Details"
		};
		//#endregion
		//#region src/client/index.tsx
		/** Required services (cordis fiber inject). */
		const inject = [
			"slots",
			"locale",
			"connection"
		];
		/**
		* Mount the section and its dictionaries.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("settings.dshdock", {
				zh,
				en
			}), "dsh-dock-bridge: section dictionaries");
			const connection = ctx.get("connection");
			if (connection === void 0) return;
			const call = async (endpoint, payload) => {
				const result = await connection.rpc.call("/dshdock-plugins", endpoint, payload ?? null, void 0);
				if (result.ok) return result.value;
				throw new Error(result.error.message);
			};
			const injected = () => ({ call });
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dshdock",
				order: 16,
				label: () => ctx.locale.bind("settings.dshdock")("nav"),
				locale: "settings.dshdock",
				inject: injected
			}, DockSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map