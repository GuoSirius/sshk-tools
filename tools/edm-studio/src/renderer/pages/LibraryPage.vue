<script setup lang="ts">
import { ref } from 'vue'
import BrandsPage from './BrandsPage.vue'
import TemplatesPage from './TemplatesPage.vue'
import FragmentsPage from './FragmentsPage.vue'

/**
 * 自定义内容库（R22）：品牌 / 模板 / 片段三管理页合并为单菜单页。
 * - 来源三类：新建（origin=custom）、系统内容「另存为→自定义内容库」派生（system:derive）、播种系统内置（只读，列表内标注）；
 * - 旧菜单 brands/templates/fragments 仍映射到本页对应 tab（兼容宿主缓存的旧 manifest）。
 */
const props = defineProps<{ menu?: string }>()
const TABS = ['brands', 'templates', 'fragments'] as const
const initial = (props.menu ?? '').split('?')[0] ?? ''
const tab = ref<(typeof TABS)[number]>(TABS.includes(initial as (typeof TABS)[number]) ? (initial as (typeof TABS)[number]) : 'brands')
</script>

<template>
  <div class="library-page">
    <el-tabs v-model="tab" class="lib-tabs">
      <el-tab-pane label="品牌" name="brands" lazy>
        <BrandsPage />
      </el-tab-pane>
      <el-tab-pane label="模板" name="templates" lazy>
        <TemplatesPage />
      </el-tab-pane>
      <el-tab-pane label="片段" name="fragments" lazy>
        <FragmentsPage />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.library-page { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.lib-tabs { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.lib-tabs :deep(.el-tabs__content) { flex: 1; min-height: 0; }
.lib-tabs :deep(.el-tab-pane) { height: 100%; }
</style>
