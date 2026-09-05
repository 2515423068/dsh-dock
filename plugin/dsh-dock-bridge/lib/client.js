window.__ModuleLoader__.load({
	id: "dsh-dock-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dshdock-css:/home/hao/DSHProgram/DSHBox/plugin/dsh-dock-bridge/src/client/DockSection.module.css.mjs
		const css = ".yFwJXq_section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}.yFwJXq_title{margin:0;font-size:18px;font-weight:600}.yFwJXq_intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px}.yFwJXq_card{border:.5px solid var(--dsw-alias-border-l4);background:0 0;border-radius:16px;flex-direction:column;gap:10px;padding:14px 16px;display:flex}.yFwJXq_cardHead{align-items:center;gap:8px;display:flex}.yFwJXq_cardTitle{letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;font-weight:600}.yFwJXq_cardActions{align-items:center;gap:6px;margin-left:auto;display:flex}.yFwJXq_cardBody{flex-direction:column;gap:6px;display:flex}.yFwJXq_rows{flex-direction:column;gap:6px;margin:0;padding:0;list-style:none;display:flex}.yFwJXq_row{border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;flex-wrap:wrap;align-items:center;gap:10px;min-height:40px;padding:8px 12px;display:flex}.yFwJXq_row:hover{background:var(--dsw-alias-interactive-bg-hover)}.yFwJXq_rowMain{flex:240px;align-items:center;gap:8px;min-width:0;display:flex}.yFwJXq_rowTitle{text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;overflow:hidden}.yFwJXq_rowMeta{color:var(--dsw-alias-label-tertiary);white-space:nowrap;align-items:center;gap:6px;font-size:12px;display:flex}.yFwJXq_rowActions{align-items:center;gap:4px;margin-left:auto;display:flex}.yFwJXq_dot{flex:none}.yFwJXq_statusLabel{color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-size:12px}.yFwJXq_selfBadge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.yFwJXq_builtinBadge{white-space:nowrap;background:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.yFwJXq_link{color:var(--dsw-alias-link);white-space:nowrap;font-size:12px;text-decoration:none}.yFwJXq_link:hover{text-decoration:underline}.yFwJXq_guide{border:.5px solid var(--dsw-alias-state-warn-primary);border-radius:12px;flex-direction:column;gap:8px;padding:12px 14px;display:flex}.yFwJXq_guideTitle{color:var(--dsw-alias-state-warn-primary);align-items:center;gap:6px;margin:0;font-size:13px;font-weight:600;display:flex}.yFwJXq_guideBody{color:var(--dsw-alias-label-secondary);white-space:pre-line;margin:0;font-size:12px}.yFwJXq_baseUrlRow{flex-wrap:wrap;align-items:center;gap:6px;display:flex}.yFwJXq_baseUrlNote{color:var(--dsw-alias-label-dimmed);margin:0;font-size:11px}.yFwJXq_errorNote{background:var(--dsw-alias-state-error-secondary);color:var(--dsw-alias-state-error-primary);border-radius:10px;flex-direction:column;gap:4px;padding:8px 12px;font-size:12px;display:flex}.yFwJXq_errorLine{overflow-wrap:anywhere;margin:0}.yFwJXq_taskInline{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border-radius:10px;flex-direction:column;gap:2px;padding:6px 12px;font-size:12px;display:flex}.yFwJXq_taskHead{align-items:center;gap:6px;display:flex}.yFwJXq_taskLine{color:var(--dsw-alias-label-dimmed);text-overflow:ellipsis;white-space:nowrap;margin:0;font-size:11px;overflow:hidden}.yFwJXq_taskFailed{color:var(--dsw-alias-state-error-primary)}.yFwJXq_outputTail{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;border-radius:8px;max-height:160px;margin:0;padding:8px 10px;font-size:11px;line-height:1.5;overflow:auto}.yFwJXq_formGrid{flex-direction:column;gap:8px;padding-top:2px;display:flex}.yFwJXq_formRow{grid-template-columns:160px 1fr;align-items:center;gap:10px;display:grid}.yFwJXq_formLabel{color:var(--dsw-alias-label-secondary);font-size:12px}.yFwJXq_formHint{color:var(--dsw-alias-label-dimmed);grid-column:2;margin:0;font-size:11px}.yFwJXq_inlineForm{border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;flex-direction:column;gap:8px;padding:10px 12px;display:flex}.yFwJXq_inlineFormRow{flex-wrap:wrap;align-items:center;gap:8px;display:flex}.yFwJXq_inlineFormActions{justify-content:flex-end;align-items:center;gap:6px;display:flex}.yFwJXq_grow{flex:160px;min-width:140px}.yFwJXq_narrow{width:120px}.yFwJXq_checkboxRow{color:var(--dsw-alias-label-primary);align-items:center;gap:6px;font-size:12px;display:flex}.yFwJXq_empty{color:var(--dsw-alias-label-dimmed);margin:0;padding:10px 12px;font-size:12px}.yFwJXq_footerNote{color:var(--dsw-alias-label-dimmed);margin:0;font-size:11px}.yFwJXq_stoppedDot{background:var(--dsw-alias-border-l3);border-radius:50%;flex:none;width:10px;height:10px}.yFwJXq_spin{animation:1s linear infinite yFwJXq_dshdock-spin}@keyframes yFwJXq_dshdock-spin{to{transform:rotate(360deg)}}";
		const tagId = "dsh-dock-bridge/DockSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-dock-bridge";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var DockSection_module_css_default = {
			"rowMeta": "yFwJXq_rowMeta",
			"formGrid": "yFwJXq_formGrid",
			"dshdock-spin": "yFwJXq_dshdock-spin",
			"errorLine": "yFwJXq_errorLine",
			"section": "yFwJXq_section",
			"taskFailed": "yFwJXq_taskFailed",
			"dot": "yFwJXq_dot",
			"title": "yFwJXq_title",
			"statusLabel": "yFwJXq_statusLabel",
			"footerNote": "yFwJXq_footerNote",
			"taskLine": "yFwJXq_taskLine",
			"cardBody": "yFwJXq_cardBody",
			"link": "yFwJXq_link",
			"stoppedDot": "yFwJXq_stoppedDot",
			"intro": "yFwJXq_intro",
			"rowActions": "yFwJXq_rowActions",
			"formRow": "yFwJXq_formRow",
			"empty": "yFwJXq_empty",
			"cardTitle": "yFwJXq_cardTitle",
			"formHint": "yFwJXq_formHint",
			"rows": "yFwJXq_rows",
			"inlineFormRow": "yFwJXq_inlineFormRow",
			"formLabel": "yFwJXq_formLabel",
			"taskInline": "yFwJXq_taskInline",
			"checkboxRow": "yFwJXq_checkboxRow",
			"card": "yFwJXq_card",
			"builtinBadge": "yFwJXq_builtinBadge",
			"guide": "yFwJXq_guide",
			"guideTitle": "yFwJXq_guideTitle",
			"baseUrlNote": "yFwJXq_baseUrlNote",
			"row": "yFwJXq_row",
			"cardActions": "yFwJXq_cardActions",
			"guideBody": "yFwJXq_guideBody",
			"inlineFormActions": "yFwJXq_inlineFormActions",
			"grow": "yFwJXq_grow",
			"spin": "yFwJXq_spin",
			"cardHead": "yFwJXq_cardHead",
			"baseUrlRow": "yFwJXq_baseUrlRow",
			"taskHead": "yFwJXq_taskHead",
			"rowMain": "yFwJXq_rowMain",
			"errorNote": "yFwJXq_errorNote",
			"rowTitle": "yFwJXq_rowTitle",
			"selfBadge": "yFwJXq_selfBadge",
			"outputTail": "yFwJXq_outputTail",
			"inlineForm": "yFwJXq_inlineForm",
			"narrow": "yFwJXq_narrow"
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
		/** Container status → dot state plus label key fragment. */
		function statusMeta(status) {
			switch (status) {
				case "running": return { state: "done" };
				case "starting": return { state: "ongoing" };
				case "failed": return { state: "error" };
				case "stopped": return { state: "stopped" };
			}
		}
		/** Status dot for a container row (stopped renders a neutral grey dot). */
		function StatusDotFor({ status }) {
			const meta = statusMeta(status);
			if (meta.state === "stopped") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: DockSection_module_css_default.stoppedDot,
				"aria-hidden": "true"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
				state: meta.state,
				size: 10,
				className: DockSection_module_css_default.dot
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
		* Containers card: the roster with status dots, self badge, and inline
		* actions; the new-container inline form; per-row task progress; and the
		* destructive confirmations (delete always, and the self-container strong
		* path for stop/update/delete with an acknowledge step).
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
			const [menuFor, setMenuFor] = (0, react.useState)();
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
				if (await store.setPort(portFor.id, Number(portValue))) {
					setPortFor(void 0);
					setPortValue("");
				} else setPortNote(t("error.operationFailed"));
			};
			const confirmTitle = confirmAction === void 0 ? "" : confirmAction.kind === "update" ? `${t("containers.update")} · ${confirmAction.row.name}` : `${t("containers.delete")} · ${confirmAction.row.name}`;
			const confirmBody = confirmAction === void 0 ? "" : confirmAction.kind === "update" ? `${confirmAction.row.name} → ${confirmAction.version}` : t("containers.deleteConfirm", { name: confirmAction.row.name });
			const selfDanger = confirmAction !== void 0 && confirmAction.row.self;
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
						children: store.containers.map((row) => {
							const task = rowTask(store, row);
							const rowBusy = store.pending("container-create", row.id) || store.pending("container-start", row.id) || store.pending("container-update", row.id) || store.isBusy(`stop:${row.id}`) || store.isBusy(`delete:${row.id}`);
							const stoppable = row.status === "running" || row.status === "starting";
							const startable = row.status === "stopped" || row.status === "failed";
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: DockSection_module_css_default.row,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: DockSection_module_css_default.rowMain,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusDotFor, { status: row.status }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: DockSection_module_css_default.rowTitle,
												children: row.name
											}),
											row.self && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: DockSection_module_css_default.selfBadge,
												children: t("containers.self")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: DockSection_module_css_default.rowMeta,
												children: [
													row.version ?? "",
													row.profile !== void 0 && ` · ${row.profile}`,
													row.port !== void 0 && ` · ${String(row.port)}`
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: DockSection_module_css_default.statusLabel,
												children: t(`containers.status.${row.status}`)
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: DockSection_module_css_default.rowActions,
										children: [
											row.url !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
												className: DockSection_module_css_default.link,
												href: row.url,
												target: "_blank",
												rel: "noreferrer",
												children: [
													t("containers.open"),
													" ",
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRightUpOutline16, { size: 12 })
												]
											}),
											startable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												size: "sm",
												icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlayOutline16, { size: 14 }),
												disabled: rowBusy,
												onClick: () => {
													store.startContainer(row.id).catch(() => {});
												},
												children: t("containers.start")
											}),
											stoppable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												size: "sm",
												icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconStopFill16, { size: 14 }),
												disabled: rowBusy,
												onClick: () => {
													if (row.self) setConfirmAction({
														kind: "stop",
														row
													});
													else store.stopContainer(row.id).catch(() => {});
												},
												children: t("containers.stop")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
												open: menuFor === row.id,
												anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
													size: "sm",
													"aria-label": t("more"),
													onClick: () => {
														setMenuFor((value) => value === row.id ? void 0 : row.id);
													},
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutline16, { size: 14 })
												}),
												items: [
													{
														id: "update",
														label: t("containers.update")
													},
													{
														id: "port",
														label: t("containers.port")
													},
													{
														id: "protect",
														label: row.devProtect === true ? t("containers.protectOn") : t("containers.protectOff")
													},
													{
														id: "delete",
														label: t("containers.delete"),
														danger: true
													}
												],
												onSelect: (id) => {
													setMenuFor(void 0);
													if (id === "update") {
														setUpdateFor(row);
														setUpdateVersion("");
													} else if (id === "port") {
														setPortFor(row);
														setPortValue(row.port !== void 0 ? String(row.port) : "");
														setPortNote(void 0);
													} else if (id === "protect") store.setProtect(row.id, row.devProtect !== true);
													else if (id === "delete") setConfirmAction({
														kind: "delete",
														row
													});
												},
												onClose: () => {
													setMenuFor(void 0);
												},
												align: "end",
												compact: true
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
						confirmLabel: confirmAction?.kind === "stop" ? t("containers.stop") : confirmAction?.kind === "update" ? t("containers.confirm") : t("containers.delete"),
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
							else store.deleteContainer(action.row.id, action.row.self).catch(() => {});
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
		//#region src/client/PluginsCard.tsx
		/**
		* Plugins card: the profile's extension plugins — view (name/version/source/
		* state), local-directory install, enable/disable (hot on web profiles),
		* uninstall. The bridge itself is marked built-in with no actions. Works
		* without the DSH Dock service.
		*/
		/** Source label key for one row's dependency spec kind. */
		function sourceLabel(t, row) {
			if (row.kind === "file") return t("plugins.source.file");
			if (row.kind === "link") return t("plugins.source.link");
			if (row.kind === "registry") return t("plugins.source.registry");
			return t("plugins.notInstalled");
		}
		/** The plugins card body; always rendered (independent of service state). */
		function PluginsCard({ t, store }) {
			const [installing, setInstalling] = (0, react.useState)(false);
			const [spec, setSpec] = (0, react.useState)("");
			const [confirmName, setConfirmName] = (0, react.useState)();
			const [notice, setNotice] = (0, react.useState)();
			const rows = store.plugins?.plugins ?? [];
			const submitInstall = async () => {
				setInstalling(true);
				setNotice(void 0);
				try {
					const answer = await store.installPlugin(spec.trim());
					if (answer.ok) {
						setSpec("");
						setInstalling(false);
						if (answer.hint !== void 0) setNotice({ title: answer.hint });
					} else setNotice({
						title: answer.error ?? t("error.operationFailed"),
						detail: answer.hint,
						output: answer.output
					});
				} finally {
					setInstalling(false);
				}
			};
			const toggle = async (row) => {
				setNotice(void 0);
				const answer = await store.setPluginEnabled(row.name, !row.active);
				if (!answer.ok) setNotice({
					title: answer.error ?? t("error.operationFailed"),
					detail: answer.hint
				});
			};
			const submitUninstall = async (name) => {
				setNotice(void 0);
				const answer = await store.uninstallPlugin(name);
				if (!answer.ok) setNotice({
					title: answer.error ?? t("error.operationFailed"),
					detail: answer.hint,
					output: answer.output
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(SectionCard, {
				title: t("plugins.title"),
				actions: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					size: "sm",
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, { size: 14 }),
					onClick: () => {
						setInstalling((value) => !value);
						setNotice(void 0);
					},
					children: t("plugins.install")
				}),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.intro,
						children: t("plugins.intro")
					}),
					installing && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: DockSection_module_css_default.inlineForm,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.inlineFormRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									className: DockSection_module_css_default.grow,
									value: spec,
									placeholder: t("plugins.pathPlaceholder"),
									onChange: (event) => {
										setSpec(event.target.value);
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "primary",
									disabled: spec.trim().length === 0 || store.isBusy("pluginInstall"),
									onClick: () => {
										submitInstall();
									},
									children: store.isBusy("pluginInstall") ? t("plugins.installing") : t("plugins.install")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									size: "sm",
									variant: "outline",
									"aria-label": t("cancel"),
									onClick: () => {
										setInstalling(false);
										setNotice(void 0);
									},
									children: "×"
								})
							]
						})
					}),
					store.pluginsError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, {
						title: store.pluginsError.title,
						detail: store.pluginsError.detail
					}),
					notice !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, {
						title: notice.title,
						detail: notice.detail,
						output: notice.output
					}),
					store.plugins?.recognized === false && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ErrorNote, { title: t("plugins.patchUnrecognized") }),
					rows.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DockSection_module_css_default.empty,
						children: t("plugins.empty")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: DockSection_module_css_default.rows,
						children: rows.map((row) => {
							const busy = store.isBusy(`pluginOp:${row.name}`);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: DockSection_module_css_default.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: DockSection_module_css_default.rowMain,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: DockSection_module_css_default.rowTitle,
											children: row.name
										}),
										row.self && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: DockSection_module_css_default.builtinBadge,
											children: t("plugins.builtin")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: DockSection_module_css_default.rowMeta,
											children: [
												row.version ?? t("plugins.versionUnknown"),
												` · ${sourceLabel(t, row)}`,
												` · ${row.active ? t("plugins.activeState") : row.disabled ? t("plugins.disabledState") : t("plugins.inactive")}`
											]
										})
									]
								}), !row.self && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: DockSection_module_css_default.rowActions,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										disabled: busy || !row.installed && !row.disabled,
										onClick: () => {
											toggle(row);
										},
										children: row.active ? t("plugins.disable") : t("plugins.enable")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										size: "sm",
										icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, { size: 14 }),
										disabled: busy || !row.installed,
										onClick: () => {
											setConfirmName(row.name);
										},
										children: t("plugins.uninstall")
									})]
								})]
							}, row.name);
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfirmDialog, {
						open: confirmName !== void 0,
						title: confirmName !== void 0 ? `${t("plugins.uninstall")} · ${confirmName}` : "",
						body: confirmName !== void 0 ? t("plugins.uninstallConfirm", { name: confirmName }) : "",
						confirmLabel: t("plugins.uninstall"),
						cancelLabel: t("cancel"),
						danger: true,
						onConfirm: () => {
							const name = confirmName;
							setConfirmName(void 0);
							if (name !== void 0) submitUninstall(name);
						},
						onClose: () => {
							setConfirmName(void 0);
						}
					})
				]
			});
		}
		//#endregion
		//#region src/client/SettingsCard.tsx
		/**
		* Settings card: DSH Dock service settings (network, port pool, auto-open)
		* plus the bridge's own service address (baseUrl). When the service is
		* unreachable the DSH-Dock fields degrade into the guide; the baseUrl field
		* stays usable because it lives in the plugin's activation row.
		*/
		const EMPTY = {
			proxy: "",
			githubMirror: "",
			npmRegistry: "",
			containerPortRange: "",
			autoOpenUiOnStart: true
		};
		/** The settings card body. */
		function SettingsCard({ t, store }) {
			const [draft, setDraft] = (0, react.useState)(EMPTY);
			const [baseUrl, setBaseUrlField] = (0, react.useState)("");
			const [savedNote, setSavedNote] = (0, react.useState)();
			const opError = store.opErrorFor(["settings", "baseUrl"]);
			(0, react.useEffect)(() => {
				if (store.settings !== void 0) setDraft(store.settings);
			}, [store.settings]);
			(0, react.useEffect)(() => {
				if (store.status !== void 0) setBaseUrlField(store.status.baseUrl);
			}, [store.status]);
			const dirty = store.settings !== void 0 && (draft.proxy !== store.settings.proxy || draft.githubMirror !== store.settings.githubMirror || draft.npmRegistry !== store.settings.npmRegistry || draft.containerPortRange !== store.settings.containerPortRange || draft.autoOpenUiOnStart !== store.settings.autoOpenUiOnStart);
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
			const field = (key, label) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: DockSection_module_css_default.formRow,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: DockSection_module_css_default.formLabel,
					children: label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
					value: draft[key],
					onChange: (event) => {
						setDraft({
							...draft,
							[key]: event.target.value
						});
					}
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(SectionCard, {
				title: t("settings.title"),
				actions: store.serviceUp && (dirty || savedNote !== void 0) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					size: "sm",
					variant: "primary",
					disabled: store.isBusy("settings"),
					onClick: () => {
						save();
					},
					children: store.isBusy("settings") ? t("settings.saving") : t("settings.save")
				}) : void 0,
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
					store.serviceUp && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: DockSection_module_css_default.formGrid,
						children: [
							field("proxy", t("settings.proxy")),
							field("githubMirror", t("settings.githubMirror")),
							field("npmRegistry", t("settings.npmRegistry")),
							field("containerPortRange", t("settings.portRange")),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: DockSection_module_css_default.formRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: DockSection_module_css_default.formLabel,
									children: t("settings.autoOpen")
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
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: DockSection_module_css_default.formGrid,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DockSection_module_css_default.formRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: DockSection_module_css_default.formLabel,
									children: t("settings.baseUrl")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: DockSection_module_css_default.formHint,
									children: t("settings.baseUrlNote")
								})
							]
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/VersionsCard.tsx
		/**
		* Versions card: the catalog as rows (tag + installed/remote-only state),
		* install with inline progress, delete with confirmation, and catalog
		* refresh. Feeds the containers card's version selects through the store.
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: DockSection_module_css_default.rows,
						children: rows.map((row) => {
							const installing = store.pending("version-install", row.tag);
							const task = store.taskFor("version-install", row.tag);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: DockSection_module_css_default.row,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: DockSection_module_css_default.rowMain,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: DockSection_module_css_default.rowTitle,
											children: row.tag
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: DockSection_module_css_default.rowMeta,
											children: row.installed ? t("versions.installed") : t("versions.remote")
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: DockSection_module_css_default.rowActions,
										children: [!row.installed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											size: "sm",
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
									}),
									task !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskInline, {
										task,
										runningLabel: t("versions.installing"),
										failedLabel: t("task.failed")
									})
								]
							}, row.tag);
						})
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
		//#region src/client/use-dock.ts
		/**
		* Data hook behind the "DSH Dock" section. One cohesive view state for the
		* four cards: environment status, containers, versions, profile plugins,
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
			const [plugins, setPlugins] = (0, react.useState)();
			const [pluginsError, setPluginsError] = (0, react.useState)();
			const [settings, setSettings] = (0, react.useState)();
			const [settingsError, setSettingsError] = (0, react.useState)();
			const [tasks, setTasks] = (0, react.useState)([]);
			const [busyOps, setBusyOps] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const [opError, setOpError] = (0, react.useState)();
			const [watching, setWatching] = (0, react.useState)([]);
			const callRef = (0, react.useRef)(call);
			callRef.current = call;
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
					setContainers(await rest("GET", "/api/containers", void 0, "容器列表加载失败"));
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
					const versions = (raw.tags ?? []).map((entry) => {
						const tag = typeof entry === "string" ? entry : entry?.name ?? "";
						return {
							tag,
							installed: installed.has(tag)
						};
					}).filter((entry) => entry.tag.length > 0);
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
			const refreshPlugins = (0, react.useCallback)(async () => {
				setPluginsError(void 0);
				try {
					setPlugins(await callRef.current("list"));
				} catch (error) {
					setPluginsError(asOpError(error));
				}
			}, []);
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
				refreshPlugins();
			}, [refreshStatus, refreshPlugins]);
			(0, react.useEffect)(() => {
				if (!serviceUp) {
					setContainers([]);
					setVersions(void 0);
					setSettings(void 0);
					return;
				}
				refreshContainers();
				refreshVersions();
				refreshSettings();
			}, [
				serviceUp,
				refreshContainers,
				refreshVersions,
				refreshSettings
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
			/** Plugin operations return the channel answer (never throw for op failures). */
			const pluginOp = (0, react.useCallback)(async (endpoint, payload) => {
				setPluginsError(void 0);
				try {
					return await callRef.current(endpoint, payload);
				} catch (error) {
					return {
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					};
				}
			}, []);
			const installPlugin = (0, react.useCallback)(async (spec) => {
				const answer = await pluginOp("install", { spec });
				if (answer.plugins !== void 0) setPlugins({
					ok: answer.ok,
					plugins: answer.plugins,
					recognized: true
				});
				return answer;
			}, [pluginOp]);
			const uninstallPlugin = (0, react.useCallback)(async (name) => {
				const answer = await pluginOp("uninstall", { name });
				if (answer.plugins !== void 0) setPlugins({
					ok: answer.ok,
					plugins: answer.plugins,
					recognized: true
				});
				return answer;
			}, [pluginOp]);
			const setPluginEnabled = (0, react.useCallback)(async (name, enabled) => {
				const answer = await pluginOp(enabled ? "enable" : "disable", { name });
				if (answer.plugins !== void 0) setPlugins({
					ok: answer.ok,
					plugins: answer.plugins,
					recognized: true
				});
				return answer;
			}, [pluginOp]);
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
				plugins,
				pluginsError,
				settings,
				settingsError,
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
				isBusy: (key) => busyOps.has(key)
			};
		}
		//#endregion
		//#region src/client/DockSection.tsx
		/**
		* The "DSH Dock" top-level settings section: environment banner plus four
		* cards (containers / versions / plugins / settings). When the service is
		* unreachable or this DSH is independent, the service-backed cards degrade
		* into the guide (installation steps + service-address field) while the
		* plugins card keeps working — it never touches the service.
		*/
		/** The section root. */
		function DockSection(props) {
			const { call, t } = props;
			const store = useDock(call);
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
					usable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ContainersCard, {
						t,
						store
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DegradedCard, {
						title: t("containers.title"),
						hint: degradeHint
					}),
					usable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VersionsCard, {
						t,
						store
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DegradedCard, {
						title: t("versions.title"),
						hint: degradeHint
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PluginsCard, {
						t,
						store
					}),
					usable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsCard, {
						t,
						store
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DegradedCard, {
						title: t("settings.title"),
						hint: degradeHint
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
			"intro": "容器 / 版本 / 插件 / 设置 —— DSH Dock 的日常管理面板。",
			"status.checking": "正在检测 DSH Dock 服务…",
			"status.serviceDown": "DSH Dock 服务未运行({baseUrl})",
			"status.serviceDownHint": "在宿主机运行 `dshdock bg` 启动服务;或确认下方\"服务地址\"后重试。",
			"status.independent": "此 DSH 为独立实例(不经 DSH Dock 运行)",
			"status.independentHint": "在宿主机安装并启动 DSH Dock 后,在下方填写服务地址,容器与版本管理即可用。插件管理不依赖服务,照常可用。",
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
			"containers.viewLog": "查看日志",
			"containers.taskFailed": "任务失败",
			"containers.status.running": "运行中",
			"containers.status.starting": "启动中",
			"containers.status.stopped": "已停止",
			"containers.status.failed": "失败",
			"versions.title": "版本",
			"versions.refresh": "刷新目录",
			"versions.refreshing": "刷新中…",
			"versions.installed": "已安装",
			"versions.remote": "仅远端",
			"versions.install": "安装",
			"versions.installing": "安装中…",
			"versions.delete": "删除",
			"versions.empty": "版本目录为空",
			"versions.cachedAt": "目录更新于 {time}",
			"versions.confirmDelete": "删除版本 {tag}?仅在本版本未被任何容器使用时允许。",
			"plugins.title": "插件管理",
			"plugins.intro": "本容器 profile 中的扩展插件(不依赖 DSH Dock 服务)。",
			"plugins.builtin": "内置",
			"plugins.empty": "未安装任何扩展插件",
			"plugins.enable": "启用",
			"plugins.disable": "禁用",
			"plugins.uninstall": "卸载",
			"plugins.uninstallConfirm": "卸载插件 {name}?将先停用(移除激活行)再删除文件。",
			"plugins.install": "安装",
			"plugins.installing": "安装中…",
			"plugins.pathPlaceholder": "本机插件目录绝对路径(可加 file: / link: 前缀)",
			"plugins.source.file": "本地",
			"plugins.source.link": "链接",
			"plugins.source.registry": "依赖",
			"plugins.versionUnknown": "未知版本",
			"plugins.notInstalled": "未安装",
			"plugins.inactive": "未激活",
			"plugins.activeState": "已启用",
			"plugins.disabledState": "已禁用",
			"plugins.patchUnrecognized": "patch 文件包含非标准结构,操作已被拒绝;请手动编辑 cordis.patch.yml。",
			"plugins.outputTail": "输出尾部",
			"settings.title": "设置",
			"settings.intro": "DSH Dock 服务端设置(网络 / 端口池 / 启动行为)与本插件的服务地址。",
			"settings.proxy": "HTTP 代理",
			"settings.githubMirror": "GitHub 镜像",
			"settings.npmRegistry": "npm 镜像源",
			"settings.portRange": "容器端口池",
			"settings.autoOpen": "启动容器后自动打开浏览器",
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
			"intro": "Containers / versions / plugins / settings — the everyday panel for DSH Dock.",
			"status.checking": "Checking the DSH Dock service…",
			"status.serviceDown": "DSH Dock service is not running ({baseUrl})",
			"status.serviceDownHint": "Run `dshdock bg` on the host machine to start it, or verify the service address below and retry.",
			"status.independent": "This DSH is an independent instance (not managed by DSH Dock)",
			"status.independentHint": "After installing and starting DSH Dock on the host machine, fill in the service address below and container/version management becomes available. Plugin management needs no service and keeps working.",
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
			"containers.viewLog": "View log",
			"containers.taskFailed": "Task failed",
			"containers.status.running": "Running",
			"containers.status.starting": "Starting",
			"containers.status.stopped": "Stopped",
			"containers.status.failed": "Failed",
			"versions.title": "Versions",
			"versions.refresh": "Refresh catalog",
			"versions.refreshing": "Refreshing…",
			"versions.installed": "Installed",
			"versions.remote": "Remote only",
			"versions.install": "Install",
			"versions.installing": "Installing…",
			"versions.delete": "Delete",
			"versions.empty": "The version catalog is empty",
			"versions.cachedAt": "Catalog updated at {time}",
			"versions.confirmDelete": "Delete version {tag}? Only allowed while no container uses it.",
			"plugins.title": "Plugins",
			"plugins.intro": "Extension plugins in this container's profile (no DSH Dock service needed).",
			"plugins.builtin": "Built-in",
			"plugins.empty": "No extension plugins installed",
			"plugins.enable": "Enable",
			"plugins.disable": "Disable",
			"plugins.uninstall": "Uninstall",
			"plugins.uninstallConfirm": "Uninstall plugin {name}? It is deactivated (activation row removed) first, then its files are deleted.",
			"plugins.install": "Install",
			"plugins.installing": "Installing…",
			"plugins.pathPlaceholder": "Absolute path of the local plugin directory (optionally file: / link:)",
			"plugins.source.file": "Local",
			"plugins.source.link": "Link",
			"plugins.source.registry": "Dependency",
			"plugins.versionUnknown": "Unknown version",
			"plugins.notInstalled": "Not installed",
			"plugins.inactive": "Inactive",
			"plugins.activeState": "Enabled",
			"plugins.disabledState": "Disabled",
			"plugins.patchUnrecognized": "The patch file contains non-standard structure; operations were refused. Edit cordis.patch.yml manually.",
			"plugins.outputTail": "Output tail",
			"settings.title": "Settings",
			"settings.intro": "DSH Dock service settings (network / port pool / startup behavior) and this plugin's service address.",
			"settings.proxy": "HTTP proxy",
			"settings.githubMirror": "GitHub mirror",
			"settings.npmRegistry": "npm registry mirror",
			"settings.portRange": "Container port range",
			"settings.autoOpen": "Open the browser automatically after starting a container",
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
				const result = await connection.rpc.call("/dshdock-plugins", endpoint, payload, void 0);
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