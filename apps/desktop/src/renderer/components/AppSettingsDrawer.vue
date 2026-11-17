<script setup lang="ts">
/**
 * 应用设置抽屉外壳（plans/09 起按 tab 拆分）：只负责左侧导航 + 分组分发 + 版本显示。
 * 各 tab 的页面与逻辑在 components/settings/ 下独立文件，新增 tab 只需加一个组件 + groups 一行。
 * 共享状态：应用配置走 composables/useAppConfig，工具目录/主题/更新走已有单例 composable。
 */
import { computed, markRaw, onMounted, ref, watch, type Component } from 'vue'
import { DataLine, InfoFilled, Setting, Share, Tools } from '@element-plus/icons-vue'
import GeneralTab from './settings/GeneralTab.vue'
import ShareTab from './settings/ShareTab.vue'
import ToolsTab from './settings/ToolsTab.vue'
import SystemTab from './settings/SystemTab.vue'
import AboutTab from './settings/AboutTab.vue'
import { loadAppConfig } from '../composables/useAppConfig'

const props = defineProps<{ modelValue: boolean; group?: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; 'create-tool': [] }>()

/** 新增 tab：加一行 groups + 一个组件即可；顺序即左侧导航顺序 */
const groups = [
  { id: 'general', label: '常规设置', hint: '主题、产物目录、启动行为', icon: markRaw(Setting), comp: markRaw(GeneralTab) },
  { id: 'tools', label: '工具与权限', hint: '启用禁用、访问密钥、分发白名单、卡片信息', icon: markRaw(Tools), comp: markRaw(ToolsTab) },
  { id: 'share', label: '分享服务', hint: '常驻分享服务与路由管理', icon: markRaw(Share), comp: markRaw(ShareTab) },
  { id: 'system', label: '系统与数据', hint: '版本、数据目录、密钥与备份策略', icon: markRaw(DataLine), comp: markRaw(SystemTab) },
  { id: 'about', label: '关于应用', hint: '配置分层与扩展约定', icon: markRaw(InfoFilled), comp: markRaw(AboutTab) },
]
const activeGroup = ref<string>(props.group ?? 'general')
watch(() => props.group, (value) => { if (value) activeGroup.value = value })

const version = ref('0.1.0')
const currentHint = computed(() => groups.find((g) => g.id === activeGroup.value)?.hint ?? '')
const activeComponent = computed<Component>(() =>
  (groups.find((g) => g.id === activeGroup.value)?.comp ?? GeneralTab) as Component,
)

onMounted(() => {
  void loadAppConfig() // 应用配置一次载入共享 reactive，各 tab 直接读
  void window.api.app.version().then((v) => { version.value = v }).catch(() => { /* 保持默认 */ })
})
</script>

<template>
  <el-drawer
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :model-value="modelValue"
    direction="rtl"
    size="min(780px, 82vw)"
    :with-header="false"
    @update:model-value="emit('update:modelValue', Boolean($event))"
  >
    <div class="settings-shell">
      <nav class="settings-nav">
        <div class="settings-nav-title">应用设置</div>
        <button
          v-for="group in groups"
          :key="group.id"
          class="settings-nav-item"
          :class="{ active: activeGroup === group.id }"
          type="button"
          @click="activeGroup = group.id"
        >
          <el-icon class="nav-icon"><component :is="group.icon" /></el-icon>
          <span>{{ group.label }}</span>
        </button>
        <div class="settings-nav-foot">
          <span>v{{ version }}</span>
          <span>分组可扩展</span>
        </div>
      </nav>

      <div class="settings-main">
        <header class="settings-head">
          <div>
            <strong>{{ groups.find((g) => g.id === activeGroup)?.label }}</strong>
            <small>{{ currentHint }}</small>
          </div>
          <el-button size="small" text @click="emit('update:modelValue', false)">关闭</el-button>
        </header>

        <div class="settings-scroll">
          <!-- 切换 tab 即卸载/重建对应组件：各 tab 在自己的 onMounted 内加载所需数据，天然按需刷新 -->
          <component :is="activeComponent" @create-tool="emit('create-tool')" />
        </div>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
/* 外壳布局（各 tab 内部卡片/行样式在全局 theme.css，见 .settings-card/.kv-line 等） */
.settings-shell { display: flex; height: 100%; min-height: 0; }
.settings-nav {
  flex: none; width: 200px; border-right: 1px solid var(--sshk-border);
  padding: 18px 12px; display: flex; flex-direction: column; gap: 4px; background: var(--sshk-appbar);
}
.settings-nav-title { font-weight: 600; padding: 0 10px 12px; }
.settings-nav-item {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 9px 10px; border: none; border-radius: 8px; background: transparent;
  color: var(--sshk-text); font-size: 13px; cursor: pointer; text-align: left;
}
.settings-nav-item:hover { background: var(--sshk-hover); }
.settings-nav-item.active { background: color-mix(in srgb, var(--sshk-accent) 16%, transparent); color: var(--sshk-accent); font-weight: 600; }
.nav-icon { flex: none; }
.settings-nav-foot { margin-top: auto; display: flex; flex-direction: column; gap: 4px; padding: 0 10px; font-size: 11px; color: var(--sshk-muted); }
.settings-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.settings-head { flex: none; display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 20px 0; }
.settings-head strong { font-size: 15px; }
.settings-head small { display: block; font-size: 12px; color: var(--sshk-muted); margin-top: 4px; }
.settings-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 20px 28px; display: flex; flex-direction: column; gap: 14px; }
</style>
