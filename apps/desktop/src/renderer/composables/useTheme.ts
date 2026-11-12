import { ref } from 'vue'
import type { ThemeMode } from '@sshk/shared'

const mode = ref<ThemeMode>('dark')
let initialized = false

function apply(next: ThemeMode): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = next === 'dark' || (next === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

export function useTheme() {
  async function init(): Promise<void> {
    if (initialized) return
    initialized = true

    const saved = await window.api.config.get('app.themeMode').catch(() => null)
    if (saved === 'dark' || saved === 'light' || saved === 'system') mode.value = saved
    apply(mode.value)

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (mode.value === 'system') apply('system')
    })
    window.api.theme.onSystemChanged(() => {
      if (mode.value === 'system') apply('system')
    })
  }

  async function setMode(next: ThemeMode): Promise<void> {
    mode.value = next
    apply(next)
    await window.api.theme.set(next)
  }

  return { mode, init, setMode }
}
