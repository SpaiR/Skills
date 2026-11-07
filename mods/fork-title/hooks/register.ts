import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

// The desktop names a fork "<parent title> (fork)", or "(fork 2)" and on.
const FORK_TITLE = /^(.*) \(fork(?: \d+)?\)$/

// The desktop's own MCP server, the one its set_session_title tool lives on.
const SERVER = 'ccd_session_mgmt'

// Whether this session's title has been looked at; a session is looked at once.
const checked = atom({ plugin: 'fork-title', key: 'checked' } as const, false)

async function sessionTitle($: EngineInterface): Promise<string | undefined> {
  const r = await $.mcp.call(SERVER, 'get_session', { session_id: 'self' })
  if (r.isError) return undefined
  const text = r.content.find(b => b.type === 'text')?.text
  if (text === undefined) return undefined
  const title: unknown = JSON.parse(text).title
  return typeof title === 'string' ? title : undefined
}

function clean(reply: string): string {
  const line = reply.trim().split('\n')[0] ?? ''
  return line.replace(/^["'«“]+|["'»”.]+$/g, '').trim().slice(0, 80)
}

async function newTitle($: EngineInterface, parent: string, message: string): Promise<string | undefined> {
  const r = await $.model.complete({
    model: 'haiku',
    effort: 'low',
    maxTokens: 64,
    timeoutMs: 20_000,
    system:
      'You name chat sessions. Reply with the title alone: 2 to 6 words, in the language of the message, ' +
      'no quotes, no trailing period.',
    prompt:
      `A session titled "${parent}" was forked into a new one. ` +
      `The first message in the new session:\n\n${message.slice(0, 4000)}\n\n` +
      'Give the new session a title that says what it is about, not a copy of the original title.',
  })
  if (!r.isAnswered) return undefined
  const title = clean(r.text)
  return title === '' ? undefined : title
}

// Never throws: renaming is a side effect of the prompt and must not fail it.
async function renameIfFork($: EngineInterface, message: string): Promise<void> {
  try {
    const title = await sessionTitle($)
    if (title === undefined) return
    await update($, checked, () => true)
    const match = FORK_TITLE.exec(title)
    if (match === null) return
    const next = await newTitle($, match[1] ?? title, message)
    if (next === undefined) return
    await $.mcp.call(SERVER, 'set_session_title', { session_id: 'self', title: next })
  } catch {
    // leave the title as it is; the next prompt tries again only if nothing was read
  }
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    const isPersonTyped = ['composer', 'bridge', 'sdk'].includes(e.origin.kind)
    if ('drop' in result || e.command !== undefined || e.isMeta || !isPersonTyped) return result
    if (await read($, checked).catch(() => true)) return result
    void renameIfFork($, e.text).catch(() => {})
    return result
  })
}
