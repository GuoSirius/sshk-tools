<script setup lang="ts">
import { ref } from 'vue'
import { RichTextEditor } from '@sshk/rich-text'

/**
 * B7 双实例验证页（用户反馈 2026-11-16：没有双富文本页面可测）：
 * 同屏两个独立编辑器 —— 只全屏 A 不影响 B，退出后各自归位；
 * 附带代码块内容，便于顺带核验暗色代码块（B6）可读性。
 * 本页不注入上传钩子/图片库：模板工具保持零上传通道，B7 只验证实例隔离。
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
      <span class="rt-hint">验证 B7：只全屏实例 A → 实例 B 不受影响；退出后各归各位。内容实时回写可在 DevTools 查看。</span>
    </div>
    <div class="rt-label">实例 A</div>
    <RichTextEditor v-model="htmlA" :readonly="readonly" />
    <div class="rt-label">实例 B</div>
    <RichTextEditor v-model="htmlB" :readonly="readonly" />
  </div>
</template>

<style scoped>
.rt-page { display: flex; flex-direction: column; gap: 10px; }
.rt-bar { display: flex; align-items: center; gap: 12px; }
.rt-hint { font-size: 12px; opacity: 0.6; }
.rt-label { font-size: 13px; font-weight: 600; opacity: 0.8; margin-top: 4px; }
</style>
