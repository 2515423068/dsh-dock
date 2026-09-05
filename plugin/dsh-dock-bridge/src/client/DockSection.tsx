/**
 * The "DSH Dock" top-level settings section: environment banner plus four
 * cards (containers / versions / plugins / settings). When the service is
 * unreachable or this DSH is independent, the service-backed cards degrade
 * into the guide (installation steps + service-address field) while the
 * plugins card keeps working — it never touches the service.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, IconWarningOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { DockT } from './locales.ts'
import { ContainersCard } from './ContainersCard.tsx'
import { PluginsCard } from './PluginsCard.tsx'
import { SettingsCard } from './SettingsCard.tsx'
import { VersionsCard } from './VersionsCard.tsx'
import css from './DockSection.module.css'
import { useDock } from './use-dock.ts'
import type { DockCall } from './use-dock.ts'
import { GuideCard, SectionCard } from './parts.tsx'

/** Business face injected into the section component. */
export interface DockSectionInjected {
  /** Call one `/dshdock-plugins` endpoint; rejects with the failure message. */
  call: DockCall
}

/** Full section component props (owner + locale + inject shares). */
export type DockSectionProps =
  & PropsRuntime<'settings.section'>
  & PropsLocale<'settings.dshdock'>
  & InjectFace<DockSectionInjected>

/** The section root. */
export function DockSection(props: DockSectionProps): ReactNode {
  const { call, t } = props
  const store = useDock(call)
  const status = store.status
  const usable = store.serviceUp && status !== undefined
  const degradeHint = store.bound ? t('status.serviceDownHint') : t('status.independentHint')

  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {status === undefined && store.statusError === undefined && (
        <p className={css.intro}>{t('status.checking')}</p>
      )}
      {store.statusError !== undefined && (
        <GuideCard title={t('error.loadFailed')} body={store.statusError} />
      )}
      {status !== undefined && !usable && (
        <UnusableGuide
          t={t}
          bound={store.bound}
          baseUrl={status.baseUrl}
          busy={store.isBusy('baseUrl')}
          onSave={(next) => { void store.setBaseUrl(next) }}
        />
      )}
      {status !== undefined && usable && (
        <p className={css.intro}>
          {t('status.okService', { baseUrl: status.baseUrl })}
          {' · '}
          {store.bound ? t('status.bound') : t('status.notBound')}
        </p>
      )}
      {usable
        ? <ContainersCard t={t} store={store} />
        : <DegradedCard title={t('containers.title')} hint={degradeHint} />}
      {usable
        ? <VersionsCard t={t} store={store} />
        : <DegradedCard title={t('versions.title')} hint={degradeHint} />}
      <PluginsCard t={t} store={store} />
      {usable
        ? <SettingsCard t={t} store={store} />
        : <DegradedCard title={t('settings.title')} hint={degradeHint} />}
    </div>
  )
}

/** Compact placeholder for a service-backed card while DSH Dock is unusable. */
function DegradedCard({ title, hint }: {
  title: string
  hint: string
}): ReactNode {
  return (
    <SectionCard title={title}>
      <p className={css.guideBody}>{hint}</p>
    </SectionCard>
  )
}

/** The service-down/independent guide: explanation plus the address field. */
function UnusableGuide({ t, bound, baseUrl, busy, onSave }: {
  t: DockT
  bound: boolean
  baseUrl: string
  busy: boolean
  onSave: (next: string) => void
}): ReactNode {
  const [value, setValue] = useState(baseUrl)
  const [adopted, setAdopted] = useState(baseUrl)
  // A fresh probe result (including the post-save reload) adopts the new value.
  if (adopted !== baseUrl) {
    setAdopted(baseUrl)
    setValue(baseUrl)
  }
  return (
    <div className={css.guide}>
      <p className={css.guideTitle}>
        <IconWarningOutline16 size={14} />
        {bound ? t('status.serviceDown', { baseUrl }) : t('status.independent')}
      </p>
      <p className={css.guideBody}>{bound ? t('status.serviceDownHint') : t('status.independentHint')}</p>
      <div className={css.baseUrlRow}>
        <Input className={css.grow} value={value} placeholder={t('status.baseUrlPlaceholder')} onChange={event => { setValue(event.target.value) }} />
        <Button size="sm" variant="primary" disabled={busy || value.trim().length === 0 || value === baseUrl} onClick={() => { onSave(value.trim()) }}>
          {t('status.baseUrlSave')}
        </Button>
      </div>
      <p className={css.baseUrlNote}>{t('status.baseUrlNote')}</p>
    </div>
  )
}
