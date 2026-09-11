/**
 * Model-config group of the settings card: the new-container initial config as an
 * editable provider table. Mirrors the DSH Dock WebUI panel (and, in field choice,
 * the harness's own Models settings section): provider rows with credential state,
 * a catalog quick-add, a custom-provider editor with base URL / protocol / models,
 * one-click import from a container, and the default-model picker. API keys are
 * write-only: the server echoes whether one is stored, never the value.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelConfigModel, ModelConfigProvider } from './api.ts'
import type { DockT } from './locales.ts'
import type { DockStore } from './use-dock.ts'
import css from './DockSection.module.css'
import { ErrorNote } from './parts.tsx'

/** One editable model row (capacities stay text until save). */
interface ModelDraft {
  id: string
  name: string
  ctx: string
  max: string
}

/** The editor draft: `targetId === 'new'` creates a row, otherwise it replaces one. */
interface Draft {
  targetId: string
  mode: 'catalog' | 'custom' | 'edit'
  id: string
  displayName: string
  api: string
  baseURL: string
  apiKeyEnv: string
  models: ModelDraft[]
  apiKey: string
  apiKeySet: boolean
}

/** Format a capacity the way the editor accepts it back (whole K/M only). */
function capText(n: number | undefined): string {
  if (typeof n !== 'number') return ''
  if (n >= 1000000 && n % 1000000 === 0) return `${n / 1000000}M`
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000}K`
  return String(n)
}

/** Parse a capacity; `''` means inherit, `null` means invalid. */
function parseCap(text: string): number | undefined | null {
  const trimmed = text.replace(/\s+/g, '')
  if (trimmed === '') return undefined
  const match = trimmed.match(/^(\d+(?:\.\d+)?)([km])?$/i)
  if (match === null) return null
  const value = Number(match[1]) * (match[2]?.toLowerCase() === 'k' ? 1000 : match[2] !== undefined ? 1000000 : 1)
  return Number.isInteger(value) && value > 0 ? value : null
}

function modelDrafts(provider: ModelConfigProvider): ModelDraft[] {
  return provider.models.map(model => ({
    id: model.id,
    name: model.name ?? '',
    ctx: capText(model.contextWindow),
    max: capText(model.maxTokens),
  }))
}

/** Build the row we send to `PUT /api/model-configs/providers/:id`. */
function toProvider(draft: Draft): ModelConfigProvider | string {
  const models: ModelConfigModel[] = []
  const seen = new Set<string>()
  for (const [index, row] of draft.models.entries()) {
    if (row.id.trim() === '') return `第 ${index + 1} 个模型缺少模型 ID`
    if (seen.has(row.id.trim())) return `模型 ID 重复:${row.id.trim()}`
    seen.add(row.id.trim())
    const model: { id: string; name?: string; contextWindow?: number; maxTokens?: number } = { id: row.id.trim() }
    if (row.name.trim() !== '') model.name = row.name.trim()
    const ctx = parseCap(row.ctx)
    if (ctx === null) return `${row.id.trim()} 的上下文窗口无法识别(可写 131072 / 256K / 1M)`
    if (ctx !== undefined) model.contextWindow = ctx
    const max = parseCap(row.max)
    if (max === null) return `${row.id.trim()} 的最大输出无法识别(可写 8192 / 32K)`
    if (max !== undefined) model.maxTokens = max
    models.push(model)
  }
  const provider: { id: string; displayName: string; api: string; baseURL: string; apiKeyEnv?: string; models: ModelConfigModel[] } = {
    id: draft.id.trim(),
    displayName: draft.displayName.trim(),
    api: draft.api,
    baseURL: draft.baseURL.trim(),
    models,
  }
  if (draft.apiKeyEnv !== '') provider.apiKeyEnv = draft.apiKeyEnv
  return provider
}

/** The model-config group body. */
export function ModelConfigGroup({ t, store }: { t: DockT; store: DockStore }): ReactNode {
  const view = store.modelConfig
  const [draft, setDraft] = useState<Draft>()
  const [source, setSource] = useState('')
  const [note, setNote] = useState<string>()
  const [failure, setFailure] = useState<string>()
  const error = store.modelConfigError
  const busy = store.isBusy('modelConfig')

  useEffect(() => {
    if (view !== undefined && source === '' && store.containers.length > 0) setSource(store.containers[0].id)
  }, [view, source, store.containers])

  const openNew = (mode: 'catalog' | 'custom'): void => {
    setFailure(undefined)
    setNote(undefined)
    const preset = mode === 'catalog'
      ? view?.presets.find(entry => entry.kind === 'catalog')
      : view?.presets.find(entry => entry.kind === 'custom')
    const provider = preset?.provider ?? { id: '', displayName: '', api: view?.protocols[0] ?? '', baseURL: '', models: [] }
    setDraft({
      targetId: 'new',
      mode,
      id: provider.id,
      displayName: provider.displayName ?? '',
      api: provider.api ?? '',
      baseURL: provider.baseURL ?? '',
      apiKeyEnv: provider.apiKeyEnv ?? '',
      models: modelDrafts(provider),
      apiKey: preset?.apiKey ?? '',
      apiKeySet: false,
    })
  }

  const openEdit = (provider: ModelConfigProvider): void => {
    setFailure(undefined)
    setNote(undefined)
    setDraft({
      targetId: provider.id,
      mode: 'edit',
      id: provider.id,
      displayName: provider.displayName ?? '',
      api: provider.api ?? '',
      baseURL: provider.baseURL ?? '',
      apiKeyEnv: provider.apiKeyEnv ?? '',
      models: modelDrafts(provider),
      apiKey: '',
      apiKeySet: provider.apiKeySet === true,
    })
  }

  const applyPreset = (presetId: string): void => {
    const preset = view?.presets.find(entry => entry.id === presetId)
    if (preset === undefined || draft === undefined) return
    setDraft({
      ...draft,
      id: preset.provider.id,
      displayName: preset.provider.displayName ?? '',
      api: preset.provider.api ?? '',
      baseURL: preset.provider.baseURL ?? '',
      apiKeyEnv: preset.provider.apiKeyEnv ?? '',
      models: modelDrafts(preset.provider),
      apiKey: preset.apiKey ?? '',
    })
  }

  const save = async (): Promise<void> => {
    if (draft === undefined) return
    const provider = toProvider(draft)
    if (typeof provider === 'string') {
      setFailure(provider)
      return
    }
    setFailure(undefined)
    const saved = await store.saveProvider(draft.targetId, provider, draft.apiKey)
    if (saved) {
      setDraft(undefined)
      setNote(t('settings.modelSaved', { provider: provider.displayName !== '' ? provider.displayName : provider.id }))
    } else {
      setFailure(t('error.operationFailed'))
    }
  }

  const importFrom = async (): Promise<void> => {
    if (source === '') return
    setFailure(undefined)
    const ok = await store.importModelConfig(source)
    setNote(ok ? t('settings.modelImported') : undefined)
    if (!ok) setFailure(t('error.operationFailed'))
  }

  if (view === undefined) {
    return (
      <>
        <h4 className={css.subTitle}>{t('settings.modelTitle')}</h4>
        {error !== undefined
          ? <ErrorNote title={error.title} detail={error.detail} />
          : <span className={css.mutedCell}>{t('settings.modelLoading')}</span>}
      </>
    )
  }

  const setDefault = async (value: string): Promise<void> => {
    const [provider, model] = value.split('|')
    if (provider === undefined || model === undefined) return
    const ok = await store.setDefaultModel(provider, model)
    if (!ok) setFailure(t('error.operationFailed'))
  }

  if (draft !== undefined) {
    const catalogPresets = view.presets.filter(entry => entry.kind === 'catalog')
    const customPresets = view.presets.filter(entry => entry.kind === 'custom')
    return (
      <>
        <h4 className={css.subTitle}>{t('settings.modelTitle')}</h4>
        {error !== undefined && <ErrorNote title={error.title} detail={error.detail} />}
        {draft.mode === 'catalog' && (
          <div className={css.rowLine}>
            <span className={css.labelCol}>{t('settings.modelProvider')}</span>
            <select className={css.verSelect} value={draft.id} onChange={event => { applyPreset(event.target.value) }}>
              {catalogPresets.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
          </div>
        )}
        {draft.mode === 'custom' && (
          <div className={css.rowLine}>
            <span className={css.labelCol}>{t('settings.modelTemplates')}</span>
            <div className={css.chipRow}>
              {customPresets.map(entry => (
                <Button key={entry.id} size="sm" onClick={() => { applyPreset(entry.id) }}>{entry.label}</Button>
              ))}
            </div>
          </div>
        )}
        <div className={css.rowLine}>
          <span className={css.labelCol}>{t('settings.modelId')}</span>
          {draft.mode === 'edit'
            ? <span className={css.mutedCell}>{draft.id}</span>
            : (
              <Input
                className={css.grow}
                value={draft.id}
                placeholder="acme-gateway"
                onChange={event => { setDraft({ ...draft, id: event.target.value }) }}
              />
              )}
        </div>
        <div className={css.rowLine}>
          <span className={css.labelCol}>{t('settings.modelKey')}</span>
          <Input
            className={css.grow}
            type="password"
            value={draft.apiKey}
            placeholder={draft.apiKeySet ? t('settings.modelKeyStored') : t('settings.modelKeyPlaceholder')}
            onChange={event => { setDraft({ ...draft, apiKey: event.target.value }) }}
          />
        </div>
        <div className={css.rowLine}>
          <span className={css.labelCol}>{t('settings.modelDisplayName')}</span>
          <Input
            className={css.grow}
            value={draft.displayName}
            onChange={event => { setDraft({ ...draft, displayName: event.target.value }) }}
          />
        </div>
        <div className={css.rowLine}>
          <span className={css.labelCol}>{t('settings.modelApi')}</span>
          <select className={css.verSelect} value={draft.api} onChange={event => { setDraft({ ...draft, api: event.target.value }) }}>
            <option value="">{t('settings.modelApiUnset')}</option>
            {view.protocols.map(protocol => <option key={protocol} value={protocol}>{protocol}</option>)}
          </select>
        </div>
        <div className={css.rowLine}>
          <span className={css.labelCol}>{t('settings.modelBaseUrl')}</span>
          <Input
            className={css.grow}
            value={draft.baseURL}
            placeholder="https://gateway.example/v1"
            onChange={event => { setDraft({ ...draft, baseURL: event.target.value }) }}
          />
        </div>
        <div className={css.rowLine}>
          <span className={css.labelCol}>{t('settings.modelCatalog')}</span>
          <span className={css.mutedCell}>{t('settings.modelCatalogHint')}</span>
          <Button size="sm" disabled={busy || draft.baseURL.trim() === ''} onClick={() => { void fetchModels() }}>
            {t('settings.modelFetch')}
          </Button>
        </div>
        {draft.models.map((row, index) => (
          <div className={css.modelRow} key={`${index}-${row.id}`}>
            <Input
              value={row.id}
              placeholder={t('settings.modelIdField')}
              onChange={event => { patchModel(index, { id: event.target.value }) }}
            />
            <Input
              value={row.name}
              placeholder={t('settings.modelNameField')}
              onChange={event => { patchModel(index, { name: event.target.value }) }}
            />
            <Input
              value={row.ctx}
              placeholder="256K"
              onChange={event => { patchModel(index, { ctx: event.target.value }) }}
            />
            <Input
              value={row.max}
              placeholder="32K"
              onChange={event => { patchModel(index, { max: event.target.value }) }}
            />
            <Button size="sm" onClick={() => { setDraft({ ...draft, models: draft.models.filter((_, at) => at !== index) }) }}>✕</Button>
          </div>
        ))}
        <div className={css.rowLine}>
          <Button size="sm" onClick={() => { setDraft({ ...draft, models: [...draft.models, { id: '', name: '', ctx: '', max: '' }] }) }}>
            {t('settings.modelAddRow')}
          </Button>
        </div>
        {failure !== undefined && <p className={css.errorNote}>{failure}</p>}
        <div className={css.saveRow}>
          <Button size="sm" onClick={() => { setDraft(undefined); setFailure(undefined) }}>{t('cancel')}</Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => { void save() }}>
            {busy ? t('settings.modelSaving') : t('settings.modelSave')}
          </Button>
        </div>
      </>
    )
  }

  return (
    <>
      <h4 className={css.subTitle}>{t('settings.modelTitle')}</h4>
      <p className={css.intro}>{t('settings.modelIntro')}</p>
      {error !== undefined && <ErrorNote title={error.title} detail={error.detail} />}
      {view.importedFrom != null && (
        <p className={css.footerNote}>
          {view.importedFrom.migratedFromLegacy === true
            ? t('settings.modelMigrated')
            : t('settings.modelImportedFrom', { source: view.importedFrom.containerName ?? '?' })}
        </p>
      )}
      {view.providers.length === 0 && <p className={css.mutedCell}>{t('settings.modelEmpty')}</p>}
      {view.providers.map(provider => (
        <div className={css.providerRow} key={provider.id}>
          <span className={css.providerName}>{provider.displayName !== undefined && provider.displayName !== '' ? provider.displayName : provider.id}</span>
          <span
            className={provider.apiKeySet === true ? css.dotOk : css.dotMiss}
            title={provider.apiKeySet === true ? t('settings.modelKeyOk') : t('settings.modelKeyMissing')}
          />
          <span className={css.mutedCell}>
            {provider.id} · {t('settings.modelCount', { count: String(provider.models.length) })} · {provider.baseURL !== undefined && provider.baseURL !== '' ? provider.baseURL : t('settings.modelCatalogEndpoint')}
          </span>
          <span className={css.providerActions}>
            <Button size="sm" onClick={() => { openEdit(provider) }}>{t('settings.modelEdit')}</Button>
            <Button size="sm" disabled={busy} onClick={() => { void remove(provider.id) }}>{t('settings.modelDelete')}</Button>
          </span>
        </div>
      ))}
      <div className={css.rowLine}>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => { openNew('catalog') }}>{t('settings.modelAdd')}</Button>
        <Button size="sm" disabled={busy} onClick={() => { openNew('custom') }}>{t('settings.modelAddCustom')}</Button>
      </div>
      <div className={css.rowLine}>
        <span className={css.labelCol}>{t('settings.modelImportLabel')}</span>
        <select className={css.verSelect} value={source} onChange={event => { setSource(event.target.value) }}>
          {store.containers.length === 0 && <option value="">{t('settings.templateNoContainer')}</option>}
          {store.containers.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
        <Button size="sm" disabled={busy || source === ''} onClick={() => { void importFrom() }}>
          {t('settings.modelImport')}
        </Button>
      </div>
      {view.defaultCandidates.length > 0 && (
        <div className={css.rowLine}>
          <span className={css.labelCol}>{t('settings.modelDefault')}</span>
          <select
            className={css.verSelect}
            value={`${view.default.provider}|${view.default.model}`}
            onChange={event => { void setDefault(event.target.value) }}
          >
            {view.defaultCandidates.map(candidate => (
              <option key={`${candidate.provider}|${candidate.model}`} value={`${candidate.provider}|${candidate.model}`}>
                {candidate.provider} / {candidate.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {note !== undefined && <p className={css.footerNote}>{note}</p>}
      {failure !== undefined && <p className={css.errorNote}>{failure}</p>}
    </>
  )

  function patchModel(index: number, patch: Partial<ModelDraft>): void {
    if (draft === undefined) return
    setDraft({ ...draft, models: draft.models.map((row, at) => (at === index ? { ...row, ...patch } : row)) })
  }

  async function remove(id: string): Promise<void> {
    const ok = await store.deleteProvider(id)
    if (!ok) setFailure(t('error.operationFailed'))
  }

  async function fetchModels(): Promise<void> {
    if (draft === undefined) return
    const answer = await store.fetchProviderModels({
      baseURL: draft.baseURL.trim(),
      api: draft.api,
      apiKey: draft.apiKey,
      providerId: draft.targetId === 'new' ? draft.id : draft.targetId,
    })
    if (typeof answer === 'string') {
      setFailure(answer)
      return
    }
    const known = new Set(draft.models.map(row => row.id))
    const added = answer.filter(model => !known.has(model.id)).map(model => ({
      id: model.id,
      name: model.name ?? '',
      ctx: capText(model.contextWindow),
      max: capText(model.maxTokens),
    }))
    setFailure(undefined)
    setDraft({ ...draft, models: [...draft.models, ...added] })
    setNote(t('settings.modelFetched', { count: String(added.length) }))
  }
}
