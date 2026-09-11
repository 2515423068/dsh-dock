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
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelConfigEntry } from './api.ts'
import type { DockT } from './locales.ts'
import type { DockStore } from './use-dock.ts'
import css from './DockSection.module.css'
import { ErrorNote } from './parts.tsx'

/** The editable detail row (`uid === 'new'` creates, otherwise it replaces). */
interface Draft {
  uid: string
  id: string
  name: string
  baseURL: string
  api: string
  apiKey: string
  apiKeySet: boolean
  apiKeyEnv: string
  label: string
  ctx: string
  max: string
  isDefault: boolean
}

/** Whole K/M only, so the text round-trips. */
function capText(n: number | undefined): string {
  if (typeof n !== 'number') return ''
  if (n >= 1000000 && n % 1000000 === 0) return `${n / 1000000}M`
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000}K`
  return String(n)
}

/** `''` inherits, a number is the value, `null` is invalid. */
function parseCap(text: string): number | undefined | null {
  const trimmed = text.replace(/\s+/g, '')
  if (trimmed === '') return undefined
  const match = trimmed.match(/^(\d+(?:\.\d+)?)([km])?$/i)
  if (match === null) return null
  const value = Number(match[1]) * (match[2] === undefined ? 1 : match[2].toLowerCase() === 'k' ? 1000 : 1000000)
  return Number.isInteger(value) && value > 0 ? value : null
}

function draftOf(entry: ModelConfigEntry, defaultUid: string): Draft {
  return {
    uid: entry.uid,
    id: entry.id,
    name: entry.name ?? '',
    baseURL: entry.baseURL ?? '',
    api: entry.api ?? '',
    apiKey: '',
    apiKeySet: entry.apiKeySet === true,
    apiKeyEnv: entry.apiKeyEnv ?? '',
    label: entry.label ?? '',
    ctx: capText(entry.contextWindow),
    max: capText(entry.maxTokens),
    isDefault: entry.uid === defaultUid,
  }
}

const BLANK: Draft = {
  uid: '', id: '', name: '', baseURL: '', api: '', apiKey: '', apiKeySet: false,
  apiKeyEnv: '', label: '', ctx: '', max: '', isDefault: false,
}

/** The model-config group body. */
export function ModelConfigGroup({ t, store }: { t: DockT; store: DockStore }): ReactNode {
  const view = store.modelConfig
  const [draft, setDraft] = useState<Draft>()
  const [open, setOpen] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [note, setNote] = useState<string>()
  const [source, setSource] = useState('')
  const busy = store.isBusy('modelConfig')

  useEffect(() => {
    if (source === '' && store.containers.length > 0) setSource(store.containers[0].id)
  }, [source, store.containers])

  // 详情区永远有内容:选中项被删、表为空、首次加载都自动落到 ★ / 第一个 / 新建草稿
  useEffect(() => {
    if (view === undefined) return
    if (draft !== undefined && (draft.uid === '' || view.models.some(entry => entry.uid === draft.uid))) return
    if (view.models.length === 0) { setDraft({ ...BLANK, api: view.protocols[0] ?? '' }); return }
    const first = view.models.find(entry => entry.uid === view.defaultUid) ?? view.models[0]
    setDraft(draftOf(first, view.defaultUid))
  }, [view, draft])

  if (view === undefined) {
    return (
      <>
        <h4 className={css.subTitle}>{t('settings.modelTitle')}</h4>
        {store.modelConfigError !== undefined
          ? <ErrorNote title={store.modelConfigError.title} detail={store.modelConfigError.detail} />
          : <span className={css.mutedCell}>{t('settings.modelLoading')}</span>}
      </>
    )
  }

  const patch = (next: Partial<Draft>): void => { if (draft !== undefined) setDraft({ ...draft, ...next }) }

  const save = async (): Promise<void> => {
    if (draft === undefined) return
    const ctx = parseCap(draft.ctx)
    const max = parseCap(draft.max)
    if (draft.id.trim() === '') { setFailure(t('settings.modelIdRequired')); return }
    if (ctx === null || max === null) { setFailure(t('settings.modelCapacityInvalid')); return }
    const model: Record<string, unknown> = {
      id: draft.id.trim(),
      name: draft.name.trim(),
      api: draft.api,
      baseURL: draft.baseURL.trim(),
      label: draft.label.trim(),
    }
    if (draft.apiKeyEnv !== '') model.apiKeyEnv = draft.apiKeyEnv
    if (ctx !== undefined) model.contextWindow = ctx
    if (max !== undefined) model.maxTokens = max
    setFailure(undefined)
    // 只按 (模型 ID, 协议, 端点) 三元组比对:命中=旧数据→更新,未命中=新数据→新建
    const exact = view.models.find(entry => entry.id === draft.id.trim() && (entry.api ?? '') === draft.api && (entry.baseURL ?? '') === draft.baseURL.trim())
    const saved = await store.saveModel(exact === undefined ? 'new' : exact.uid, model, draft.apiKey)
    if (!saved) { setFailure(t('error.operationFailed')); return }
    setNote(t('settings.modelSaved', { model: draft.id.trim() }))
    setDraft(undefined)
  }

  const removeUid = async (uid: string, id: string): Promise<void> => {
    const ok = await store.deleteModel(uid)
    if (!ok) { setFailure(t('error.operationFailed')); return }
    setNote(t('settings.modelDeleted', { model: id }))
    setDraft(undefined)
  }

  const importFrom = async (): Promise<void> => {
    if (source === '') return
    setFailure(undefined)
    const ok = await store.importModelConfig(source)
    if (!ok) { setFailure(t('error.operationFailed')); return }
    setNote(t('settings.modelImported'))
    setDraft(undefined)
  }

  const currentLabel = draft === undefined
    ? t('settings.modelPickNone')
    : draft.uid === 'new'
      ? t('settings.modelNewDraft')
      : `${draft.uid === view.defaultUid ? '★ ' : ''}${draft.id}${draft.label !== '' ? ` · ${draft.label}` : ''}`

  return (
    <>
      <h4 className={css.subTitle}>{t('settings.modelTitle')}</h4>
      <p className={css.intro}>{t('settings.modelIntro')}</p>
      {store.modelConfigError !== undefined && <ErrorNote title={store.modelConfigError.title} detail={store.modelConfigError.detail} />}
      {view.importedFrom != null && (
        <p className={css.footerNote}>
          {view.importedFrom.migratedFromLegacy === true
            ? t('settings.modelMigrated')
            : t('settings.modelImportedFrom', { source: view.importedFrom.containerName ?? '?' })}
        </p>
      )}

      <div className={css.rowLine}>
        <span className={css.labelCol}>{t('settings.modelImportLabel')}</span>
        <select className={css.verSelect} value={source} onChange={event => { setSource(event.target.value) }}>
          {store.containers.length === 0 && <option value="">{t('settings.templateNoContainer')}</option>}
          {store.containers.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
        <Button size="sm" variant="outline" disabled={busy || source === ''} onClick={() => { void importFrom() }}>
          {t('settings.modelImport')}
        </Button>
      </div>

      <div className={css.rowLine}>
        <div className={css.dd}>
          <button type="button" className={css.ddTrigger} onClick={() => { setOpen(!open) }}>
            <span className={css.ddLabel}>{currentLabel}</span>
            <span className={css.ddCaret}>▾</span>
          </button>
          {open && (
            <div className={css.ddPanel}>
              {view.models.length === 0 && <div className={css.ddItemMuted}>{t('settings.modelEmpty')}</div>}
              {view.passthrough.map(item => (
                <div key={`pass-${item.route}`} className={css.ddItem}>
                  <span className={css.ddTag}>{t('settings.modelCatalogTag')}</span>
                  <b>{item.route}</b>
                  <span className={css.ddMeta}>{item.displayName}</span>
                  <span className={css.grow} />
                  <button
                    type="button"
                    className={css.ddX}
                    title={t('settings.modelDelete')}
                    onClick={() => { void store.deletePassthrough(item.route).then(() => { setDraft(undefined) }) }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {view.models.map(entry => (
                <div
                  key={entry.uid}
                  className={draft?.uid === entry.uid ? css.ddItemActive : css.ddItem}
                  onClick={() => { setFailure(undefined); setDraft(draftOf(entry, view.defaultUid)); setOpen(false) }}
                >
                  <button
                    type="button"
                    className={entry.uid === view.defaultUid ? css.ddStarOn : css.ddStar}
                    title={entry.uid === view.defaultUid ? t('settings.modelDefaultCurrent') : t('settings.modelDefault')}
                    onClick={event => { event.stopPropagation(); void store.setDefaultModel(entry.uid).then(() => { setDraft(undefined) }) }}
                  >
                    {entry.uid === view.defaultUid ? '★' : '☆'}
                  </button>
                  <b className={css.ddName}>{entry.name !== undefined && entry.name !== '' ? entry.name : entry.id}</b>
                  <span className={css.ddProv}>{entry.providerLabel ?? ''}</span>
                  <span className={css.grow} />
                  <button
                    type="button"
                    className={css.ddX}
                    title={t('settings.modelDelete')}
                    onClick={event => { event.stopPropagation(); void removeUid(entry.uid, entry.id) }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={css.detailFrame}>
        {draft === undefined
          ? <p className={css.mutedCell}>{t('settings.modelDetailHint')}</p>
          : (
            <>
              <div className={css.modelField}>
                <span className={css.labelCol}>{t('settings.modelIdField')}</span>
                <Input className={css.grow} value={draft.id} onChange={event => { patch({ id: event.target.value }) }} />
              </div>
              <div className={css.modelField}>
                <span className={css.labelCol}>{t('settings.modelNameField')}</span>
                <Input className={css.grow} value={draft.name} onChange={event => { patch({ name: event.target.value }) }} />
              </div>
              <div className={css.modelField}>
                <span className={css.labelCol}>{t('settings.modelBaseUrl')}</span>
                <Input className={css.grow} value={draft.baseURL} placeholder="https://gateway.example/v1" onChange={event => { patch({ baseURL: event.target.value }) }} />
              </div>
              <div className={css.modelField}>
                <span className={css.labelCol}>{t('settings.modelApi')}</span>
                <select className={css.verSelect} value={draft.api} onChange={event => { patch({ api: event.target.value }) }}>
                  {view.protocols.map(protocol => <option key={protocol} value={protocol}>{protocol}</option>)}
                </select>
              </div>
              <div className={css.modelField}>
                <span className={css.labelCol}>{t('settings.modelKey')}</span>
                <Input
                  className={css.grow}
                  type="password"
                  value={draft.apiKey}
                  placeholder={draft.apiKeySet ? t('settings.modelKeyStored') : t('settings.modelKeyPlaceholder')}
                  onChange={event => { patch({ apiKey: event.target.value }) }}
                />
              </div>
              <div className={css.modelField}>
                <span className={css.labelCol}>{t('settings.modelProviderLabel')}</span>
                <Input className={css.grow} value={draft.label} placeholder={t('settings.modelProviderLabelHint')} onChange={event => { patch({ label: event.target.value }) }} />
              </div>
              <div className={css.modelField}>
                <span className={css.labelCol}>{t('settings.modelCapacity')}</span>
                <Input className={css.capInput} value={draft.ctx} placeholder="256K" onChange={event => { patch({ ctx: event.target.value }) }} />
                <Input className={css.capInput} value={draft.max} placeholder="32K" onChange={event => { patch({ max: event.target.value }) }} />
              </div>
              <div className={css.rowLine}>
                <span className={css.mutedCell}>
                  {draft.uid === ''
                    ? ''
                    : draft.uid === view.defaultUid ? t('settings.modelDefaultCurrent') : t('settings.modelDefaultHint')}
                </span>
                <span className={css.grow} />
                <Button size="sm" variant="outline" disabled={busy || draft.uid === ''} onClick={() => { void removeUid(draft.uid, draft.id) }}>
                  {t('settings.modelDelete')}
                </Button>
                <Button size="sm" variant="primary" disabled={busy} onClick={() => { void save() }}>
                  {busy ? t('settings.modelSaving') : t('settings.modelSave')}
                </Button>
              </div>
              {failure !== undefined && <p className={css.errorNote}>{failure}</p>}
            </>
          )}
      </div>

      {view.providers.length > 0 && (
        <p className={css.footerNote}>
          {t('settings.modelProvidersNote', { count: String(view.providers.length), routes: view.providers.map(entry => `${entry.route}(${entry.modelCount})`).join('、') })}
        </p>
      )}
      {note !== undefined && <p className={css.footerNote}>{note}</p>}
    </>
  )
}
