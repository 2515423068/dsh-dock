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
					return;
				}
				refreshContainers();
				refreshVersions();
				refreshSettings();
				refreshTemplate();
			}, [
				serviceUp,
				refreshContainers,
				refreshVersions,
				refreshSettings,
				refreshTemplate
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
			const captureTemplate = (0, react.useCallback)(async (containerId) => {
				try {
					await mutate("template", () => rest("POST", "/api/profile-template", { containerId }, "模板捕获失败"));
					refreshTemplate();
					return true;
				} catch {
					return false;
				}
			}, [
				mutate,
				rest,
				refreshTemplate
			]);
			const clearTemplate = (0, react.useCallback)(async () => {
				try {
					await mutate("template", () => rest("DELETE", "/api/profile-template", void 0, "模板清除失败"));
					refreshTemplate();
					return true;
				} catch {
					return false;
				}
			}, [
				mutate,
				rest,
				refreshTemplate
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
				captureTemplate,
				clearTemplate,
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
				isBusy: (key) => busyOps.has(key)
			};
		}
		//#endregion
		//#region \0dshdock-css:/home/hao/DSHProgram/DSHBox/plugin/dsh-dock-bridge/src/client/DockSection.module.css.mjs
		const css = ".yFwJXq_section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}.yFwJXq_title{margin:0;font-size:18px;font-weight:600}.yFwJXq_intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px}.yFwJXq_tabs{border-bottom:.5px solid var(--dsw-alias-border-l2);align-items:flex-end;gap:22px;margin-top:2px;display:flex}.yFwJXq_tab{color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:0;padding:7px 1px 9px;font-size:13px;line-height:20px;position:relative}.yFwJXq_tab:hover,.yFwJXq_tab[data-active=true]{color:var(--dsw-alias-label-primary)}.yFwJXq_tab[data-active=true]:after,.yFwJXq_tab:focus-visible:after{background:var(--dsw-alias-label-primary);content:\"\";border-radius:2px 2px 0 0;height:2px;position:absolute;bottom:-1px;left:0;right:0}.yFwJXq_tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:2px}.yFwJXq_tabPanel{min-width:0;padding-top:2px}.yFwJXq_card{border:.5px solid var(--dsw-alias-border-l4);background:0 0;border-radius:16px;flex-direction:column;gap:10px;padding:14px 16px;display:flex}.yFwJXq_cardHead{align-items:center;gap:8px;display:flex}.yFwJXq_cardTitle{letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;font-weight:600}.yFwJXq_cardActions{align-items:center;gap:6px;margin-left:auto;display:flex}.yFwJXq_cardBody{flex-direction:column;gap:6px;display:flex}.yFwJXq_rows{flex-direction:column;gap:12px;margin:0;padding:0;list-style:none;display:flex}.yFwJXq_row{border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;flex-direction:column;align-items:stretch;padding:14px 16px;display:flex}.yFwJXq_rowHead{align-items:center;gap:10px;margin-bottom:8px;display:flex}.yFwJXq_rowTitle{text-overflow:ellipsis;white-space:nowrap;font-size:15px;font-weight:500;line-height:22px;overflow:hidden}.yFwJXq_rowMeta{color:var(--dsw-alias-label-tertiary);margin-bottom:10px;font-size:13px;line-height:20px}.yFwJXq_verSelect{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-2);width:auto;max-width:210px;height:28px;color:var(--dsw-alias-label-primary);vertical-align:middle;border-radius:8px;padding:0 6px;font-size:12.5px;line-height:18px}.yFwJXq_logPath{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:16px;font-family:var(--ds-font-family-code);word-break:break-all;margin-bottom:8px}.yFwJXq_rowUrl{min-width:0;margin-bottom:10px;overflow:hidden}.yFwJXq_rowActions{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.yFwJXq_table{border-collapse:collapse;width:100%;font-size:13px;line-height:20px}.yFwJXq_table th{text-align:left;color:var(--dsw-alias-label-tertiary);border-bottom:.5px solid var(--dsw-alias-border-l2);padding:10px;font-size:12px;font-weight:500;line-height:18px}.yFwJXq_table td{border-bottom:.5px solid var(--dsw-alias-border-l1);vertical-align:middle;padding:10px}.yFwJXq_table tbody tr:last-child td{border-bottom:none}.yFwJXq_cellRight{text-align:right;white-space:nowrap}.yFwJXq_mutedCell{color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:20px}.yFwJXq_dot{flex:none}.yFwJXq_statusLabel{height:24px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);white-space:nowrap;border-radius:12px;align-items:center;padding:0 10px;font-size:12px;line-height:18px;display:inline-flex}.yFwJXq_statusLabel[data-status=running]{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent)}.yFwJXq_statusLabel[data-status=starting]{color:var(--dsw-alias-state-warn-label);background:color-mix(in srgb, var(--dsw-alias-state-warn-label) 12%, transparent)}.yFwJXq_statusLabel[data-status=failed]{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)}.yFwJXq_selfBadge{white-space:nowrap;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-radius:999px;flex:none;padding:2px 10px;font-size:12px;font-weight:600;line-height:18px}.yFwJXq_builtinBadge{white-space:nowrap;background:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.yFwJXq_link{color:var(--dsw-alias-link);word-break:break-all;font-size:12.5px;font-weight:500;line-height:20px;text-decoration:none}.yFwJXq_link:hover{text-underline-offset:3px;text-decoration:underline dotted}.yFwJXq_guide{border:.5px solid var(--dsw-alias-state-warn-primary);border-radius:12px;flex-direction:column;gap:8px;padding:12px 14px;display:flex}.yFwJXq_guideTitle{color:var(--dsw-alias-state-warn-label);align-items:center;gap:6px;margin:0;font-size:13px;font-weight:600;display:flex}.yFwJXq_guideBody{color:var(--dsw-alias-label-secondary);white-space:pre-line;margin:0;font-size:12px}.yFwJXq_baseUrlRow{flex-wrap:wrap;align-items:center;gap:6px;display:flex}.yFwJXq_baseUrlNote{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}.yFwJXq_errorNote{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);color:var(--dsw-alias-state-error-primary);border-radius:10px;flex-direction:column;gap:4px;padding:8px 12px;font-size:12px;display:flex}.yFwJXq_errorLine{overflow-wrap:anywhere;margin:0}.yFwJXq_taskInline{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border-radius:10px;flex-direction:column;gap:2px;padding:6px 12px;font-size:12px;display:flex}.yFwJXq_taskHead{align-items:center;gap:6px;display:flex}.yFwJXq_taskLine{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;margin:0;font-size:11px;overflow:hidden}.yFwJXq_taskFailed{color:var(--dsw-alias-state-error-primary)}.yFwJXq_outputTail{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;border-radius:8px;max-height:160px;margin:0;padding:8px 10px;font-size:11px;line-height:1.5;overflow:auto}.yFwJXq_subTitle{margin:6px 0 0;font-size:15px;font-weight:500;line-height:22px}.yFwJXq_rowLine{flex-wrap:wrap;align-items:center;gap:10px;display:flex}.yFwJXq_labelCol{width:120px;color:var(--dsw-alias-label-tertiary);flex:none;font-size:12.5px;line-height:20px}.yFwJXq_chipRow{flex-wrap:wrap;gap:6px;display:inline-flex}.yFwJXq_hintIcon{vertical-align:middle;color:var(--dsw-alias-label-tertiary);cursor:help;border-radius:4px;margin-left:2px;display:inline-flex}.yFwJXq_hintIcon:hover{color:var(--dsw-alias-label-primary)}.yFwJXq_hintIcon:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.yFwJXq_rangeInput{width:150px}.yFwJXq_saveRow{margin-top:10px;display:flex}.yFwJXq_formGrid{flex-direction:column;gap:8px;padding-top:2px;display:flex}.yFwJXq_formRow{grid-template-columns:160px 1fr;align-items:center;gap:10px;display:grid}.yFwJXq_formLabel{color:var(--dsw-alias-label-secondary);font-size:12px}.yFwJXq_inlineForm{border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;flex-direction:column;gap:8px;padding:10px 12px;display:flex}.yFwJXq_inlineFormRow{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.yFwJXq_inlineFormActions{justify-content:flex-end;align-items:center;gap:6px;display:flex}.yFwJXq_grow{flex:160px;min-width:140px}.yFwJXq_narrow{width:120px}.yFwJXq_checkboxRow{color:var(--dsw-alias-label-primary);align-items:center;gap:6px;font-size:12px;display:flex}.yFwJXq_empty{text-align:center;color:var(--dsw-alias-label-tertiary);margin:0;padding:30px 0;font-size:13.5px;line-height:22px}.yFwJXq_footerNote{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}.yFwJXq_stoppedDot{background:var(--dsw-alias-border-l3);border-radius:50%;flex:none;width:10px;height:10px}.yFwJXq_spin{animation:1s linear infinite yFwJXq_dshdock-spin}@keyframes yFwJXq_dshdock-spin{to{transform:rotate(360deg)}}";
		const tagId = "dsh-dock-bridge/DockSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-dock-bridge";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var DockSection_module_css_default = {
			"rowHead": "yFwJXq_rowHead",
			"cardHead": "yFwJXq_cardHead",
			"builtinBadge": "yFwJXq_builtinBadge",
			"row": "yFwJXq_row",
			"card": "yFwJXq_card",
			"cardTitle": "yFwJXq_cardTitle",
			"rowUrl": "yFwJXq_rowUrl",
			"logPath": "yFwJXq_logPath",
			"dot": "yFwJXq_dot",
			"taskFailed": "yFwJXq_taskFailed",
			"inlineFormRow": "yFwJXq_inlineFormRow",
			"checkboxRow": "yFwJXq_checkboxRow",
			"stoppedDot": "yFwJXq_stoppedDot",
			"section": "yFwJXq_section",
			"taskLine": "yFwJXq_taskLine",
			"inlineFormActions": "yFwJXq_inlineFormActions",
			"rows": "yFwJXq_rows",
			"tabs": "yFwJXq_tabs",
			"rowTitle": "yFwJXq_rowTitle",
			"cardBody": "yFwJXq_cardBody",
			"baseUrlRow": "yFwJXq_baseUrlRow",
			"formLabel": "yFwJXq_formLabel",
			"inlineForm": "yFwJXq_inlineForm",
			"guideTitle": "yFwJXq_guideTitle",
			"errorNote": "yFwJXq_errorNote",
			"formRow": "yFwJXq_formRow",
			"verSelect": "yFwJXq_verSelect",
			"taskHead": "yFwJXq_taskHead",
			"statusLabel": "yFwJXq_statusLabel",
			"intro": "yFwJXq_intro",
			"guide": "yFwJXq_guide",
			"tab": "yFwJXq_tab",
			"chipRow": "yFwJXq_chipRow",
			"footerNote": "yFwJXq_footerNote",
			"cellRight": "yFwJXq_cellRight",
			"grow": "yFwJXq_grow",
			"narrow": "yFwJXq_narrow",
			"hintIcon": "yFwJXq_hintIcon",
			"table": "yFwJXq_table",
			"formGrid": "yFwJXq_formGrid",
			"guideBody": "yFwJXq_guideBody",
			"title": "yFwJXq_title",
			"outputTail": "yFwJXq_outputTail",
			"rowLine": "yFwJXq_rowLine",
			"labelCol": "yFwJXq_labelCol",
			"dshdock-spin": "yFwJXq_dshdock-spin",
			"saveRow": "yFwJXq_saveRow",
			"cardActions": "yFwJXq_cardActions",
			"mutedCell": "yFwJXq_mutedCell",
			"selfBadge": "yFwJXq_selfBadge",
			"errorLine": "yFwJXq_errorLine",
			"subTitle": "yFwJXq_subTitle",
			"rowActions": "yFwJXq_rowActions",
			"tabPanel": "yFwJXq_tabPanel",
			"empty": "yFwJXq_empty",
			"spin": "yFwJXq_spin",
			"link": "yFwJXq_link",
			"rangeInput": "yFwJXq_rangeInput",
			"baseUrlNote": "yFwJXq_baseUrlNote",
			"taskInline": "yFwJXq_taskInline",
			"rowMeta": "yFwJXq_rowMeta"
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
		* creation time; log path; url; flat actions plus the protect checkbox),
		* the new-container inline form, per-row task progress, and the destructive
		* confirmations (delete always, and the self-container strong path for
		* stop/update/delete with an acknowledge step).
		*/
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
				"protect:"
			]);
			const submitCreate = async (input) => {
				try {
					await store.createContainer(input);
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
		/** New-container inline form: name, version select (fed by the versions card), profile select. */
		function CreateForm({ t, versions, busy, onSubmit, onCancel }) {
			const [name, setName] = (0, react.useState)("");
			const [version, setVersion] = (0, react.useState)("");
			const [profile, setProfile] = (0, react.useState)("web");
			const valid = name.trim().length > 0 && version.length > 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: DockSection_module_css_default.inlineForm,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: DockSection_module_css_default.inlineFormRow,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
							className: DockSection_module_css_default.grow,
							value: name,
							placeholder: t("containers.namePlaceholder"),
							onChange: (event) => {
								setName(event.target.value);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
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
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							className: DockSection_module_css_default.narrow,
							value: profile,
							onChange: (event) => {
								setProfile(event.target.value);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "web",
								children: "web"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "headless",
								children: "headless"
							})]
						})
					]
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
								profile
							});
						},
						children: busy ? t("containers.creating") : t("containers.create")
					})]
				})]
			});
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
			autoOpenUiOnStart: true
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
			const [tplSource, setTplSource] = (0, react.useState)("");
			const [tplConfirmClear, setTplConfirmClear] = (0, react.useState)(false);
			const [baseUrl, setBaseUrlField] = (0, react.useState)("");
			const [savedNote, setSavedNote] = (0, react.useState)();
			const opError = store.opErrorFor([
				"settings",
				"baseUrl",
				"template"
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
			const capture = async (containerId) => {
				setSavedNote(void 0);
				const saved = await store.captureTemplate(containerId);
				setSavedNote(saved ? t("settings.saved") : t("error.operationFailed"));
			};
			const clear = async () => {
				setTplConfirmClear(false);
				setSavedNote(void 0);
				const saved = await store.clearTemplate();
				setSavedNote(saved ? t("settings.saved") : t("error.operationFailed"));
			};
			const chip = (label, apply) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
				onClick: apply,
				children: label
			}, label);
			const effectiveSource = tplSource !== "" ? tplSource : store.containers[0]?.id ?? "";
			const tpl = store.template;
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
					store.templateError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, {
						title: store.templateError.title,
						detail: store.templateError.detail
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
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
							className: DockSection_module_css_default.subTitle,
							children: t("settings.template")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.rowLine,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: DockSection_module_css_default.labelCol,
									children: [
										t("settings.templateLabel"),
										" ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Hint, { text: t("settings.templateHint") })
									]
								}),
								tpl !== void 0 && tpl.exists ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, { children: t("settings.templateCaptured", {
									source: tpl.source ?? "?",
									sections: String(tpl.sections?.length ?? 0),
									keys: tpl.refKeys !== void 0 && tpl.refKeys.length > 0 ? tpl.refKeys.join(" / ") : t("settings.templateNoKeys")
								}) }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: DockSection_module_css_default.mutedCell,
									children: t("settings.templateNone")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									className: DockSection_module_css_default.verSelect,
									value: effectiveSource,
									onChange: (event) => {
										setTplSource(event.target.value);
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
									variant: "primary",
									disabled: effectiveSource.length === 0 || store.isBusy("template"),
									onClick: () => {
										capture(effectiveSource);
									},
									children: t("settings.templateImport")
								}),
								tpl !== void 0 && tpl.exists && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									onClick: () => {
										setTplConfirmClear(true);
									},
									children: t("settings.templateClear")
								})
							]
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfirmDialog, {
						open: tplConfirmClear,
						title: t("settings.templateClear"),
						body: t("settings.templateClearConfirm"),
						confirmLabel: t("settings.templateClear"),
						cancelLabel: t("cancel"),
						danger: true,
						busy: store.isBusy("template"),
						onConfirm: () => {
							clear();
						},
						onClose: () => {
							setTplConfirmClear(false);
						}
					})
				]
			});
		}
		//#endregion
		//#region src/client/VersionsCard.tsx
		/**
		* Versions card: the catalog as a WebUI-shaped table (version / status /
		* activity / actions), install with inline progress, delete with
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
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("versions.dynamic") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
								className: DockSection_module_css_default.cellRight,
								children: t("versions.action")
							})
						] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: rows.map((row) => {
							const installing = store.pending("version-install", row.tag);
							const task = store.taskFor("version-install", row.tag);
							const lastLine = task?.lines !== void 0 && task.lines.length > 0 ? task.lines[task.lines.length - 1] : void 0;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: row.tag }) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: DockSection_module_css_default.statusLabel,
									"data-status": row.installed ? "running" : "stopped",
									children: row.installed ? t("versions.installed") : t("versions.remote")
								}) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
									className: DockSection_module_css_default.mutedCell,
									children: row.remote ? lastLine ?? "" : t("versions.remoteExtra")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
									className: DockSection_module_css_default.cellRight,
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
		* The "DSH Dock" top-level settings section: environment banner plus three
		* cards (containers / versions / settings). When the service is unreachable
		* or this DSH is independent, service-backed cards degrade into the guide.
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
			"containers.profileLabel": "profile",
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
			"versions.dynamic": "动态",
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
			"containers.profileLabel": "Profile",
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
			"versions.dynamic": "Activity",
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