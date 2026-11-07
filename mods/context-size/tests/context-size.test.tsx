import { expect, test } from 'claude-code/testing'

const MODE = {
  plugin: 'context-size',
  component: 'SessionMode',
  surface: 'desktop',
  props: { modes: [] as string[] },
} as const

const MSG = { role: 'user', text: 'hi', toolUses: [] } as const

const USAGE = {
  value: { startedAt: 0, context: { tokens: 170_000, window: 200_000, percent: 85 }, rateLimits: {}, cost: { usd: 0 } },
}

test('the chip shows the used percent', async ($, on) => {
  on('session.usage', () => USAGE)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await new Promise(r => setTimeout(r, 0))

  const ui = await $.ui.mount(MODE)
  expect((await ui.find({ type: 'Text' }))?.text).toBe('85%')
  await ui.unmount()
})

test('a compaction shows a label, then the size it reports', async ($, on) => {
  let release = () => {}
  const gate = new Promise<void>(r => (release = r))
  on('session.usage', () => USAGE)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('session.compact', async () => {
    await gate
    return { messages: [MSG], tokensBefore: 170_000, tokensAfter: 18_000 }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await new Promise(r => setTimeout(r, 0))

  const compaction = $.session.compact({ trigger: 'manual', messages: [MSG] })
  await new Promise(r => setTimeout(r, 0))
  const during = await $.ui.mount(MODE)
  expect((await during.find({ type: 'Text' }))?.text).toBe('compacting')
  await during.unmount()

  release()
  await compaction
  const after = await $.ui.mount(MODE)
  expect((await after.find({ type: 'Text' }))?.text).toBe('9%')
  await after.unmount()
})
