import { expect, test } from 'claude-code/testing'

const MODE = {
  plugin: 'context-size',
  component: 'SessionMode',
  surface: 'desktop',
  props: { modes: [] as string[] },
} as const

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
