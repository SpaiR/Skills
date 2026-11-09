export type Usage = { tokens: number; window: number; percent: number } | null

declare module 'claude-code' {
  interface PluginState {
    'context-size': { usage: Usage }
  }
}
