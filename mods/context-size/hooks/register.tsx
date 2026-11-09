import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Usage } from '../types'

const usage = atom({ plugin: 'context-size', key: 'usage' } as const, null as Usage)

// Never throws: a failed read must not fail the event it rides on.
async function refresh($: EngineInterface): Promise<void> {
  try {
    const { context } = await $.session.usage()
    const value: Usage =
      context.tokens === undefined
        ? null
        : { tokens: context.tokens, window: context.window, percent: context.percent ?? 0 }
    await update($, usage, () => value)
  } catch {
    // keep the last figure
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.ui.status(undefined) // clears the status line an earlier version pinned
    void refresh($).catch(() => {})
    return result
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    void refresh($).catch(() => {})
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    void refresh($).catch(() => {})
    return result
  })

  // The desktop draws the tree this hook returns as a chip in the prompt footer,
  // with no plugin name in front (unlike $.ui.status).
  on('ui.render', { component: 'SessionMode', surface: 'desktop' }, async ($, e, next) => {
    const { Text } = $.ui.resolve(e)
    const u = await read($, usage)
    if (u === null) return next(e)
    return <Text dimColor tabular>{`${u.percent}%`}</Text>
  })
}
