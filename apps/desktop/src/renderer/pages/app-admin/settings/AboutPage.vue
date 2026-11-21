<script setup lang="ts">
/**
 * 应用管理 > 应用设置 > 关于应用（P4-3 页化 · 迁即重构，吸收原 AboutTab）：
 * 运行环境卡（window.api.app.runtime() 直拉，与顶栏「更多 > 关于应用」轻弹框 AboutDialog 各自加载同一数据源）
 * + 配置分层约定表（口径已改为应用管理：入口=应用管理 > 应用设置 / 应用管理左菜单）。
 */
import { onMounted, ref } from 'vue'

const runtime = ref<{ version: string; commit: string; electron: string; chrome: string; node: string } | null>(null)
onMounted(() => { void window.api.app.runtime().then((r) => { runtime.value = r }).catch(() => { /* 保持默认 */ }) })
</script>

<template>
  <div class="admin-subpage">
    <div class="tool-page-head">
      <strong>关于应用</strong>
      <span class="muted" style="margin-left: 12px">运行环境、配置分层约定</span>
    </div>
    <div class="admin-subpage-body">
      <section class="settings-card">
        <div class="card-title">运行环境</div>
        <template v-if="runtime">
          <div class="kv-line"><span>版本</span><strong>v{{ runtime.version }}（{{ runtime.commit }}）</strong></div>
          <div class="kv-line"><span>Electron</span><span class="hint">{{ runtime.electron }}</span></div>
          <div class="kv-line"><span>Chrome</span><span class="hint">{{ runtime.chrome }}</span></div>
          <div class="kv-line"><span>Node.js</span><span class="hint">{{ runtime.node }}</span></div>
        </template>
        <div v-else class="hint">运行环境信息加载中…</div>
      </section>
      <section class="settings-card">
        <div class="card-title">配置分层约定</div>
        <table class="about-table">
          <thead><tr><th>层级</th><th>落盘</th><th>入口</th></tr></thead>
          <tbody>
            <tr><td>应用 / 系统</td><td><code>app.*</code></td><td>应用管理 &gt; 应用设置（常规设置 / 工具与权限 / 系统与数据；分享服务在 分享管理 &gt; 工具设置）</td></tr>
            <tr><td>工具自有</td><td><code>tools.&lt;id&gt;.*</code></td><td>工具左侧「工具配置」页（single / menu 两种形态，由工具包清单声明）</td></tr>
            <tr><td>工具清单</td><td><code>tools/&lt;id&gt;/tool.manifest.json</code></td><td>名称、描述、多分类标签、图标、菜单、配置项、默认配置、依赖、权限、插件入口</td></tr>
            <tr><td>密钥</td><td><code>secrets.bin</code>（safeStorage）</td><td>主进程注入，永不下发渲染层</td></tr>
          </tbody>
        </table>
        <div class="hint" style="margin-top: 12px">后期新增应用级菜单只需在应用管理左菜单加一组；新增工具只需把工具包放进 <code>tools/&lt;id&gt;/</code> 并写好自己的 tool.manifest.json —— 宿主构建期自动发现，零改动接入。</div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.admin-subpage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 留白 token（规范 §2.1）：页面内边距 var(--sshk-page-padding)，卡片间距 var(--sshk-gap-md) */
.admin-subpage-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--sshk-page-padding);
  display: flex;
  flex-direction: column;
  gap: var(--sshk-gap-md);
}
</style>
