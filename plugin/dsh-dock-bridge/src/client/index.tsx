/**
 * dsh-dock-bridge browser half — the "DSH Dock" top-level settings section.
 *
 * Registers the section into `settings.section` (id `dshdock`, order 16,
 * right after the Plugins section), ships the zh/en dictionaries under the
 * `settings.dshdock` namespace, and closes the `/dshdock-plugins` channel
 * caller over the client context for the section's inject face.
 */
// Type-only: the ctx.locale merge and the settings slot types.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.slots merge (the renderer owns the composition service).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the connection handle type for the get-and-cast read.
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: the slots service and slot contracts.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the settings shell's SlotMap merge ('settings.section').
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { DockSection } from './DockSection.tsx'
import type { DockSectionInjected } from './DockSection.tsx'
import { en, zh } from './locales.ts'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection']

/**
 * Mount the section and its dictionaries.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.locale.register('settings.dshdock', { zh, en }),
    'dsh-dock-bridge: section dictionaries',
  )

  const connection = ctx.get('connection') as ConnectionHandle | undefined
  if (connection === undefined) return

  const call = async <T,>(endpoint: string, payload?: unknown): Promise<T> => {
    const result = await connection.rpc.call('/dshdock-plugins', endpoint, payload ?? null, undefined)
    if (result.ok) return result.value as T
    throw new Error(result.error.message)
  }

  const injected = (): DockSectionInjected => ({ call })

  // Ordered after Plugins (order 15): the bridge rides on a container the
  // user already manages, and its own plugin row shows up in that card.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'dshdock',
    order: 16,
    label: () => ctx.locale.bind('settings.dshdock')('nav'),
    locale: 'settings.dshdock',
    inject: injected,
  }, DockSection))
}
