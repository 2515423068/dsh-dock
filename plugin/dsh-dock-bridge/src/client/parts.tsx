/**
 * Shared presentation parts of the "DSH Dock" section: card frame, confirm
 * dialog (with the self-danger acknowledge step), error note, and inline
 * task progress. Pure props components over primitives and tokens.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, IconLoadingOutline16, IconWarningOutline16, Modal, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DockTask } from './api.ts'
import css from './DockSection.module.css'

/** One settings card: uppercase head row with actions plus the body stack. */
export function SectionCard({ title, actions, children }: {
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={css.card}>
      <div className={css.cardHead}>
        <h3 className={css.cardTitle}>{title}</h3>
        {actions !== undefined && <div className={css.cardActions}>{actions}</div>}
      </div>
      <div className={css.cardBody}>{children}</div>
    </section>
  )
}

/** Confirmation dialog; `acknowledgeLabel` adds the self-danger gate. */
export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, danger = false, acknowledgeLabel, busy = false, onConfirm, onClose }: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
  acknowledgeLabel?: string
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const [acknowledged, setAcknowledged] = useState(false)
  const blocked = busy || (acknowledgeLabel !== undefined && !acknowledged)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      closeLabel={cancelLabel}
      footer={(
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>{cancelLabel}</Button>
          <Button variant={danger ? 'primary' : 'primary'} disabled={blocked} onClick={() => { setAcknowledged(false); onConfirm() }}>
            {busy ? cancelLabel : confirmLabel}
          </Button>
        </>
      )}
    >
      <p className={css.guideBody}>{body}</p>
      {acknowledgeLabel !== undefined && (
        <label className={css.checkboxRow}>
          <input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />
          <span>{acknowledgeLabel}</span>
        </label>
      )}
    </Modal>
  )
}

/** Red error note with the operation's message and optional output tail. */
export function ErrorNote({ title, detail, output }: {
  title: string
  detail?: string
  output?: readonly string[]
}) {
  return (
    <div className={css.errorNote}>
      <p className={css.errorLine}>{title}</p>
      {detail !== undefined && <p className={css.errorLine}>{detail}</p>}
      {output !== undefined && output.length > 0 && (
        <pre className={css.outputTail}>{output.slice(-12).join('\n')}</pre>
      )}
    </div>
  )
}

/** Inline task progress: spinner + label + the freshest log line. */
export function TaskInline({ task, runningLabel, failedLabel }: {
  task: DockTask | undefined
  runningLabel: string
  failedLabel: string
}) {
  if (task === undefined) return null
  const failed = task.status === 'failed'
  const lastLine = task.lines !== undefined && task.lines.length > 0 ? task.lines[task.lines.length - 1] : undefined
  return (
    <div className={css.taskInline}>
      <div className={css.taskHead}>
        {task.status === 'running'
          ? <IconLoadingOutline16 size={14} className={css.spin} />
          : <StateDot state={failed ? 'error' : 'done'} size={10} className={css.dot} />}
        <span className={failed ? css.taskFailed : undefined}>{failed ? failedLabel : runningLabel}</span>
        {task.error !== undefined && <span className={css.taskLine}>{task.error}</span>}
      </div>
      {lastLine !== undefined && <p className={css.taskLine}>{lastLine}</p>}
    </div>
  )
}

/** Container status → dot state plus label key fragment. */
export function statusMeta(status: ContainerStatus): { state: 'done' | 'ongoing' | 'error' | 'stopped' } {
  switch (status) {
    case 'running': return { state: 'done' }
    case 'starting': return { state: 'ongoing' }
    case 'failed': return { state: 'error' }
    case 'stopped': return { state: 'stopped' }
  }
}

export type ContainerStatus = 'running' | 'starting' | 'stopped' | 'failed'

/** Status dot for a container row (stopped renders a neutral grey dot). */
export function StatusDotFor({ status }: { status: ContainerStatus }) {
  const meta = statusMeta(status)
  if (meta.state === 'stopped') return <span className={css.stoppedDot} aria-hidden="true" />
  return <StateDot state={meta.state} size={10} className={css.dot} />
}

/** Guide card shown when the DSH Dock side of a feature is unusable. */
export function GuideCard({ title, body, icon }: {
  title: string
  body: string
  icon?: ReactNode
}) {
  return (
    <div className={css.guide}>
      <p className={css.guideTitle}>{icon ?? <IconWarningOutline16 size={14} />}{title}</p>
      <p className={css.guideBody}>{body}</p>
    </div>
  )
}
