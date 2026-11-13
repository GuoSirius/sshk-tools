<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ToolPageLayout } from '@sshk/ui-kit'
import { useTheme } from './composables/useTheme'
import type { ThemeMode } from '@sshk/shared'

// 左侧多级菜单（配置管理 → 应用配置 / 工具配置 / 系统与数据）定位到对应分区
const props = defineProps<{ section?: string }>()
const SECTION_MAP: Record<string, string> = {
  'config-app': 'app',
  'config-tools': 'tools',
  'config-system': 'system',
}
const sectionKey = computed(() => SECTION_MAP[props.section ?? ''] ?? '')

const { mode, setMode } = useTheme()
const cfg = reactive({
  outputDir: '',
  launchOnBoot: false,
  tray: true,
  ttlHours: 72,
  renderStrict: true,
  autoEscape: true,
  badgeAttr: 'data-edm-badge',
  clicksField: 'clicks' as 'clicks' | 'totalClicks',
  stripUtm: true,
})
const version = ref('0.1.0')
const saving = ref(false)

async function str(key: string, fallback: string): Promise<string> {
  return String((await window.api.config.get(key)) ?? fallback)
}
async function bool(key: string, fallback: boolean): Promise<boolean> {
  const v = await window.api.config.get(key)
  return typeof v === 'boolean' ? v : fallback
}
async function num(key: string, fallback: number): Promise<number> {
  const v = Number(await window.api.config.get(key))
  return Number.isFinite(v) ? v : fallback
}

function focusSection(key: string): void {
  if (!key) return
  void nextTick(() => {
    document.querySelector(`[data-section="${key}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })
}
watch(sectionKey, focusSection, { immediate: true })

onMounted(async () => {
  cfg.outputDir = (await str('app.outputDir', '')) === 'null' ? '' : await str('app.outputDir', '')
  cfg.launchOnBoot = await bool('app.launchOnBoot', false)
  cfg.tray = await bool('app.tray', true)
  cfg.ttlHours = await num('app.share.ttlHours', 72)
  cfg.renderStrict = await bool('tools.edm-studio.render.strict', true)
  cfg.autoEscape = await bool('tools.edm-studio.render.autoEscape', true)
  cfg.badgeAttr = await str('tools.badge-studio.badgeAttr', 'data-edm-badge')
  cfg.clicksField = (await str('tools.badge-studio.clicksField', 'clicks')) === 'totalClicks' ? 'totalClicks' : 'clicks'
  cfg.stripUtm = await bool('tools.badge-studio.urlNorm.stripUtm', true)
  version.value = await window.api.app.version().catch(() => '0.1.0')
})

async function save(): Promise<void> {
  saving.value = true
  try {
    const pairs: [string, unknown][] = [
      ['app.outputDir', cfg.outputDir.trim() || null],
      ['app.launchOnBoot', cfg.launchOnBoot],
      ['app.tray', cfg.tray],
      ['app.share.ttlHours', Number(cfg.ttlHours)],
      ['tools.edm-studio.render.strict', cfg.renderStrict],
      ['tools.edm-studio.render.autoEscape', cfg.autoEscape],
      ['tools.badge-studio.badgeAttr', cfg.badgeAttr.trim() || 'data-edm-badge'],
      ['tools.badge-studio.clicksField', cfg.clicksField],
      ['tools.badge-studio.urlNorm.stripUtm', cfg.stripUtm],
    ]
    for (const [key, value] of pairs) await window.api.config.set(key, value)
    ElMessage.success('配置已保存（产物目录变更需重启应用生效）')
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    saving.value = false
  }
}

async function pickDir(): Promise<void> {
  const dir = await window.api.os.pickDir()
  if (dir) cfg.outputDir = dir
}

function openDataDir(): void { void window.api.app.openDataDir() }
async function onTheme(next: ThemeMode): Promise<void> { await setMode(next) }
</script>

<template>
  <ToolPageLayout title="配置管理" description="应用与工具配置（写入 settings.json；密钥在模型控制台单独加密管理）">
    <template #actions>
      <el-button type="primary" size="small" :loading="saving" @click="save">保存配置</el-button>
    </template>

    <div class="settings-grid">
      <section class="panel" :class="{ 'is-focused': sectionKey === 'app' }" data-section="app">
        <div class="panel-head"><span class="dot" />应用配置</div>
        <el-form label-width="110px" size="small">
          <el-form-item label="主题模式">
            <el-select :model-value="mode" style="width: 180px" @change="onTheme">
              <el-option label="暗黑" value="dark" />
              <el-option label="亮色" value="light" />
              <el-option label="跟随系统" value="system" />
            </el-select>
          </el-form-item>
          <el-form-item label="产物目录">
            <div style="display:flex; gap:8px; width:100%">
              <el-input v-model="cfg.outputDir" placeholder="留空 = 默认 userData/sshk-data" />
              <el-button @click="pickDir">选择</el-button>
            </div>
            <div class="hint">变更需重启应用生效；本机路径不会进入备份包</div>
          </el-form-item>
          <el-form-item label="开机自启"><el-switch v-model="cfg.launchOnBoot" /></el-form-item>
          <el-form-item label="系统托盘"><el-switch v-model="cfg.tray" /></el-form-item>
          <el-form-item label="分享有效期">
            <el-input-number v-model="cfg.ttlHours" :min="1" :max="720" size="small" />
            <span class="hint" style="margin-left:8px">小时（token 到期即失效）</span>
          </el-form-item>
        </el-form>
      </section>

      <section class="panel" :class="{ 'is-focused': sectionKey === 'tools' }" data-section="tools">
        <div class="panel-head"><span class="dot" />工具配置</div>
        <el-form label-width="110px" size="small">
          <el-form-item label="EDM 严格模式">
            <el-switch v-model="cfg.renderStrict" />
            <span class="hint" style="margin-left:8px">未定义变量直接报错</span>
          </el-form-item>
          <el-form-item label="HTML 转义">
            <el-switch v-model="cfg.autoEscape" />
            <span class="hint" style="margin-left:8px">防数据注入</span>
          </el-form-item>
          <el-form-item label="badge 属性">
            <el-input v-model="cfg.badgeAttr" style="width: 200px" />
          </el-form-item>
          <el-form-item label="角标数值列">
            <el-radio-group v-model="cfg.clicksField">
              <el-radio value="clicks">clicks</el-radio>
              <el-radio value="totalClicks">totalClicks</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="去 UTM 参数"><el-switch v-model="cfg.stripUtm" /></el-form-item>
        </el-form>
      </section>

      <section class="panel" :class="{ 'is-focused': sectionKey === 'system' }" data-section="system">
        <div class="panel-head"><span class="dot" />系统与数据</div>
        <div class="kv"><span>应用版本</span><strong>v{{ version }}</strong></div>
        <div class="kv"><span>数据目录</span><el-button size="small" text @click="openDataDir">打开</el-button></div>
        <div class="kv"><span>一键备份</span><span class="hint">导出/导入 zip 能力见 packages/backup（菜单后续接入）</span></div>
        <div class="kv"><span>密钥管理</span><span class="hint">Model Console → 模型 Provider（safeStorage 加密）</span></div>
      </section>
    </div>

    <template #footer>
      <span class="muted">所有配置走主进程 ConfigService 原子写入 · 密钥永不进入 settings.json</span>
    </template>
  </ToolPageLayout>
</template>

<style scoped>
.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 12px;
}
.panel {
  border: 1px solid var(--sshk-border);
  border-radius: 10px;
  padding: 14px 16px;
  background: var(--sshk-panel);
  transition: border-color .2s ease, box-shadow .2s ease;
}
.panel.is-focused {
  border-color: var(--sshk-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--sshk-accent) 14%, transparent);
}
.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  margin-bottom: 14px;
}
.dot {
  width: 6px;
  height: 14px;
  border-radius: 3px;
  background: var(--sshk-accent);
}
.hint, .muted { font-size: 12px; opacity: .6; }
.kv {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px dashed var(--sshk-border);
  font-size: 13px;
}
.kv:last-child { border-bottom: none; }
</style>
