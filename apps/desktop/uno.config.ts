import { defineConfig, presetUno } from 'unocss'

export default defineConfig({
  presets: [presetUno()],
  theme: {
    colors: {
      app: {
        bg: 'var(--sshk-bg)',
        panel: 'var(--sshk-panel)',
        border: 'var(--sshk-border)',
        text: 'var(--sshk-text)',
        muted: 'var(--sshk-muted)',
        accent: 'var(--sshk-accent)',
      },
    },
  },
  shortcuts: {
    'app-surface': 'bg-[var(--sshk-panel)] text-[var(--sshk-text)] border border-[var(--sshk-border)]',
  },
})
