export type Checked = boolean

declare module 'claude-code' {
  interface PluginState {
    'fork-title': { checked: Checked }
  }
}
