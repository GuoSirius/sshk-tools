<script setup lang="ts">
import { computed, ref } from 'vue'
import { RichTextEditor } from '@sshk/rich-text'
import { toolId } from '../state'
import { createTemplateImageLibrary } from '../image-library'

/**
 * B7 双实例验证页 + 图片库/源码/状态栏验证（用户反馈 2026-11-16）：
 * - 同屏两个独立编辑器 —— 只全屏 A 不影响 B，退出后各自归位；
 *   附带代码块内容，便于顺带核验暗色代码块（B6）可读性。
 * - 两实例均注入图片库（本地/远程/云来源 + 上传 + 列图插入），
 *   与 EDM 同构走宿主全局上传通道，可在此验证「图片库」按钮与实例隔离。
 * - 工具栏含「查看源码」按钮；底部状态栏显示字数/字符/段落。
 */
const htmlA = ref(
  '<h2>实例 A</h2><p>这里是第一个编辑器。点击工具栏最右侧「全屏」，确认铺满且另一实例不受影响。</p>' +
  '<pre><code>const greeting = "hello A";\nconsole.log(greeting);</code></pre>' +
  '<p>全屏中<b>加粗</b>、<i>斜体</i>、<a href="https://example.com">链接</a>与图片都应正常。</p>',
)
const htmlB = ref(
  '<h2>实例 B</h2><p>第二个编辑器：A 处于全屏时本实例应保持原位、内容不丢。</p>' +
  '<ul><li>待办一</li><li>待办二</li></ul>' +
  '<blockquote>退出全屏后，A 回到表单原位置，本块无残留样式。</blockquote>',
)
const readonly = ref(false)

/** 图片库桥接按 toolId 生成（宿主注入后才有值；未配置远程/云 profile 时只有本地来源） */
const library = computed(() => createTemplateImageLibrary(toolId.value || 'template-tool'))

function reset(): void {
  htmlA.value = '<h2>实例 A</h2><p>内容已重置。</p>'
  htmlB.value = '<h2>实例 B</h2><p>内容已重置。</p>'
}
</script>

<template>
  <div class="rt-page">
    <div class="rt-bar">
      <el-checkbox v-model="readonly">两实例只读</el-checkbox>
      <el-button size="small" @click="reset">重置内容</el-button>
      <span class="rt-hint">
        验证 B7：只全屏实例 A → 实例 B 不受影响；退出后各归各位。
        工具栏「图片库」可上传/从图床选图插入（来源在「上传配置」里维护）；
        「查看源码」可查看/编辑 HTML；底部为字数统计。
      </span>
    </div>
    <div class="rt-label">实例 A</div>
    <RichTextEditor v-model="htmlA" :readonly="readonly" :image-library="library" />
    <div class="rt-label">实例 B</div>
    <RichTextEditor v-model="htmlB" :readonly="readonly" :image-library="library" />
  </div>
</template>

<style scoped>
.rt-page { display: flex; flex-direction: column; gap: 10px; }
.rt-bar { display: flex; align-items: center; gap: 12px; }
.rt-hint { font-size: 12px; opacity: 0.6; }
.rt-label { font-size: 13px; font-weight: 600; opacity: 0.8; margin-top: 4px; }
</style>
