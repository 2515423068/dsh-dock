/**
 * 页面内路径选择器:「选择配置目录」与「从配置文件创建…」共用同一界面,与 WebUI
 * 的页面内选择器同构 —— 快捷入口 + 面包屑 + 单层列举(目录在前,file 模式再列配置
 * 文件)+ 可选新建文件夹 + 选定。不拉起任何系统对话框,也不产生子进程。
 */
import { Fragment, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FsEntry, FsListing, OpError } from './api.ts'
import type { DockT } from './locales.ts'
import type { DockStore, PathPickerMode } from './use-dock.ts'
import css from './DockSection.module.css'
import { ErrorNote } from './parts.tsx'

/** 一行列举:目录进入下一层,配置文件选中后待确认。 */
type PickRow = { readonly entry: FsEntry; readonly kind: 'dir' | 'file' }

/**
 * 选目录 / 选配置文件共用的页面内选择器。
 * @param mode - `dir` 选定当前文件夹;`file` 需先选中一个配置文件。
 * @param startPath - 打开时的起始路径(空串 = 主目录)。
 * @param onPick - 确认后的目标绝对路径;调用方负责收尾(保存目录 / 读取配置文件)。
 * @param onClose - 取消或关闭。
 */
export function PathPickerDialog({ t, store, mode, startPath, onPick, onClose }: {
  t: DockT
  store: DockStore
  mode: PathPickerMode
  startPath: string
  onPick: (path: string) => void
  onClose: () => void
}): ReactNode {
  const [listing, setListing] = useState<FsListing>()
  const [failure, setFailure] = useState<OpError>()
  const [fellBack, setFellBack] = useState(false)
  const [selected, setSelected] = useState<string>()
  const [mkdirOpen, setMkdirOpen] = useState(false)
  const [mkdirName, setMkdirName] = useState('')
  const [mkdirFailed, setMkdirFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const started = useRef(false)

  /** 列举一层;fallback 只在打开时开,用最近存在的上级目录兜住不存在的起始路径。 */
  const go = async (target: string, fallback = false): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    setSelected(undefined)
    const answer = await store.browseDirectory(mode, target, fallback)
    setBusy(false)
    if (answer.listing === undefined) {
      setFailure(answer.failure)
      return
    }
    setListing(answer.listing)
    setFellBack(answer.fellBack)
    setMkdirOpen(false)
    setMkdirName('')
    setMkdirFailed(false)
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    void go(startPath, true)
    // 起始目录只定一次,之后由面包屑/快捷入口驱动。
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const crumbs = listing?.crumbs ?? []
  const rows: readonly PickRow[] = listing === undefined
    ? []
    : [
      ...listing.entries.map(entry => ({ entry, kind: 'dir' as const })),
      ...(listing.files ?? []).map(entry => ({ entry, kind: 'file' as const })),
    ]
  const defaultDir = listing?.defaultConfigDir ?? ''

  const confirm = (): void => {
    if (listing === undefined) return
    if (mode === 'dir') onPick(listing.path)
    else if (selected !== undefined) onPick(selected)
  }

  const submitMkdir = async (): Promise<void> => {
    const parent = listing?.path
    const name = mkdirName.trim()
    if (parent === undefined || name.length === 0) return
    setMkdirFailed(false)
    const created = await store.makeDirectory(parent, name)
    if (created === undefined) {
      setMkdirFailed(true)
      return
    }
    await go(created)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'dir' ? t('picker.titleDir') : t('picker.titleFile')}
      closeLabel={t('cancel')}
      className={css.pickDialog}
      footer={(
        <>
          {mode === 'dir' && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || listing === undefined}
              onClick={() => { setMkdirFailed(false); setMkdirOpen(true) }}
            >
              {t('picker.newFolder')}
            </Button>
          )}
          <span className={css.pickSpacer} />
          {mode === 'dir'
            ? (
              <Button size="sm" variant="primary" disabled={busy || listing === undefined} onClick={confirm}>
                {t('picker.chooseCurrent')}
              </Button>
            )
            : (
              <Button size="sm" variant="primary" disabled={selected === undefined} onClick={confirm}>
                {t('picker.choose')}
              </Button>
            )}
          <Button size="sm" variant="outline" onClick={onClose}>{t('cancel')}</Button>
        </>
      )}
    >
      {listing === undefined && failure === undefined && <p className={css.empty}>{t('picker.loading')}</p>}
      {failure !== undefined && <ErrorNote title={t('picker.readFailed')} detail={failure.title} />}

      {listing !== undefined && (
        <>
          <div className={css.pickQuick}>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { void go(listing.home) }}>
              {t('picker.home')}
            </Button>
            {defaultDir.length > 0 && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => { void go(defaultDir) }}>
                {t('picker.defaultDir')}
              </Button>
            )}
          </div>

          <div className={css.pickCrumbs}>
            {crumbs.map((crumb, index) => (index === crumbs.length - 1
              ? <span key={crumb.path} className={css.pickCrumbCurrent}>{crumb.name}</span>
              : (
                <Fragment key={crumb.path}>
                  <button
                    type="button"
                    className={css.pickCrumb}
                    disabled={busy}
                    onClick={() => { void go(crumb.path) }}
                  >
                    {crumb.name}
                  </button>
                  <span className={css.pickSep}>/</span>
                </Fragment>
              )))}
          </div>

          <div className={css.pickList}>
            {rows.length === 0 && <p className={css.empty}>{t('picker.empty')}</p>}
            {rows.map(({ entry, kind }) => {
              const classes = [css.pickRow]
              if (kind === 'file') classes.push(css.pickRowFile)
              if (entry.hidden) classes.push(css.pickRowHidden)
              if (kind === 'file' && selected === entry.path) classes.push(css.pickRowSelected)
              return (
                <button
                  key={`${kind}:${entry.path}`}
                  type="button"
                  className={classes.join(' ')}
                  disabled={busy}
                  onClick={() => {
                    if (kind === 'dir') void go(entry.path)
                    else setSelected(entry.path)
                  }}
                >
                  <span className={css.pickIcon} aria-hidden="true">{kind === 'file' ? '📄' : '📁'}</span>
                  <span className={css.pickName}>{entry.name}</span>
                </button>
              )
            })}
          </div>
        </>
      )}

      {mkdirOpen && (
        <div className={css.pickMkdir}>
          <Input
            className={css.grow}
            value={mkdirName}
            placeholder={t('picker.mkdirPlaceholder')}
            autoFocus
            onChange={event => { setMkdirName(event.target.value) }}
            onKeyDown={event => { if (event.key === 'Enter') void submitMkdir() }}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={busy || mkdirName.trim().length === 0}
            onClick={() => { void submitMkdir() }}
          >
            {t('picker.mkdirConfirm')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setMkdirOpen(false); setMkdirName(''); setMkdirFailed(false) }}
          >
            {t('cancel')}
          </Button>
        </div>
      )}

      {fellBack && <p className={css.footerNote}>{t('picker.fallback')}</p>}
      {listing?.truncated === true && <p className={css.footerNote}>{t('picker.truncated')}</p>}
      {mkdirFailed && <p className={css.footerNote}>{t('picker.mkdirFailed')}</p>}
    </Modal>
  )
}
