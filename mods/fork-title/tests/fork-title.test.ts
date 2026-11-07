import { expect, test } from 'claude-code/testing'

const PROMPT = { text: 'добавь экспорт в CSV', wait: false, origin: { kind: 'sdk' } } as const

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0))
}

const session = (title: string) => ({
  value: { content: [{ type: 'text', text: JSON.stringify({ sessionId: 'local_1', title }) }], isError: false },
})

test('a fork is renamed after its first message', async ($, on) => {
  const calls: { tool: string; args: Record<string, unknown> }[] = []
  let asked = ''
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('mcp.call', (_, e) => {
    calls.push({ tool: e.tool, args: e.args })
    if (e.tool === 'get_session') return session('Размер контекста (fork 2)')
    return { value: { content: [], isError: false } }
  })
  on('model.complete', (_, e) => {
    asked = typeof e.prompt === 'string' ? e.prompt : ''
    return { value: { isAnswered: true, text: '«Экспорт в CSV».', usage: { input_tokens: 1, output_tokens: 1 } } }
  })

  await $.prompt.submit(PROMPT)
  await settle()

  expect(asked).toContain('Размер контекста')
  expect(asked).toContain('добавь экспорт в CSV')
  expect(calls.at(-1)).toEqual({ tool: 'set_session_title', args: { session_id: 'self', title: 'Экспорт в CSV' } })

  // Looked at once: the next prompt asks the desktop nothing.
  const before = calls.length
  await $.prompt.submit(PROMPT)
  await settle()
  expect(calls.length).toBe(before)
})

test('a session that is not a fork keeps its title', async ($, on) => {
  const tools: string[] = []
  let completions = 0
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('mcp.call', (_, e) => {
    tools.push(e.tool)
    return session('Размер контекста')
  })
  on('model.complete', () => {
    completions += 1
    return { value: { isAnswered: true, text: 'x', usage: { input_tokens: 1, output_tokens: 1 } } }
  })

  await $.prompt.submit(PROMPT)
  await settle()
  await $.prompt.submit(PROMPT)
  await settle()

  expect(tools).toEqual(['get_session'])
  expect(completions).toBe(0)
})
