import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Usage } from '../types'

const usage = atom({ plugin: 'context-size', key: 'usage' } as const, null as Usage)
const compacting = atom({ plugin: 'context-size', key: 'compacting' } as const, false)

// Never throws: a failed read must not fail the tool call or compaction it rides on.
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

// Never throws, for the same reason as refresh.
async function afterCompaction($: EngineInterface, tokensAfter: number | undefined): Promise<void> {
  try {
    const before = await read($, usage)
    if (tokensAfter === undefined || before === null) return void (await refresh($))
    const { window } = before
    await update($, usage, () => ({ tokens: tokensAfter, window, percent: Math.round((tokensAfter / window) * 100) }))
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

  // Only compactions of the main conversation that change it: not a background
  // precompute, not a subagent's own transcript.
  on('session.compact', async ($, e, next) => {
    if (e.trigger === 'precompute' || e.agentId !== undefined) return next(e)
    await update($, compacting, () => true).catch(() => {})
    try {
      const result = await next(e)
      // usage() keeps the pre-compaction figure until the next model response,
      // so take the size the compaction itself reports.
      await afterCompaction($, 'tokensAfter' in result ? result.tokensAfter : undefined)
      return result
    } finally {
      await update($, compacting, () => false).catch(() => {})
    }
  })

  // The desktop draws the tree this hook returns as a chip in the prompt footer,
  // with no plugin name in front (unlike $.ui.status).
  on('ui.render', { component: 'SessionMode', surface: 'desktop' }, async ($, e, next) => {
    const { Text } = $.ui.resolve(e)
    if (await read($, compacting)) return <Text dimColor>compacting</Text>
    const u = await read($, usage)
    if (u === null) return next(e)
    return <Text dimColor tabular>{`${u.percent}%`}</Text>
  })
}
