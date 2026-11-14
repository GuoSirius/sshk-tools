<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { chatInput, chatProviderId, chatting, messages, providers, activeProvider } from '../state'

// LLM 输出为不可信内容：先 markdown 解析再 DOMPurify 净化，避免 v-html XSS
marked.setOptions({ gfm: true, breaks: true })

const chatScroller = ref<HTMLElement | null>(null)
/**
 * 是否"钉在底部"：用户滚到接近底部时为真，往上滚则为假（暂停自动滚动）。
 * 自主判定逻辑（类 WorkBuddy 输出区）：用户上滚→不抢滚；用户回到底部→恢复自动滚。
 */
const chatAutoScroll = ref(true)
/** 距底多少像素内算"在底部"（容差，规避小数/滚动惯性误判） */
const CHAT_BOTTOM_THRESHOLD = 48

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= CHAT_BOTTOM_THRESHOLD
}
/** 滚动事件：自主判定是否允许自动滚到底部 */
function onChatScroll(): void {
  const el = chatScroller.value
  if (el) chatAutoScroll.value = isNearBottom(el)
}
/** 仅当钉在底部才自动滚底；force 用于用户主动发送时强制回底 */
function scrollChatToBottom(force = false): void {
  if (!force && !chatAutoScroll.value) return
  requestAnimationFrame(() => {
    const el = chatScroller.value
    if (el) el.scrollTop = el.scrollHeight
  })
}
/** 点击"回到底部"：立即滚底并恢复自动滚动 */
function scrollToBottomNow(): void {
  const el = chatScroller.value
  if (!el) return
  el.scrollTop = el.scrollHeight
  chatAutoScroll.value = true
}

// ── WorkBuddy 式统一输入区：无边框 textarea 自适应增高（上限 160px），发送后清空回焦 ──
const composerEl = ref<HTMLTextAreaElement | null>(null)
const COMPOSER_MAX_HEIGHT = 160
function onComposerInput(): void {
  const el = composerEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`
}

/** Markdown 解析 + 净化（防 XSS）；流式过程中随增量内容实时重渲染即"打字式"效果 */
function renderMd(src: string): string {
  return DOMPurify.sanitize(marked.parse(src || '', { async: false }) as string)
}

async function sendChat(): Promise<void> {
  const provider = activeProvider.value
  const text = chatInput.value.trim()
  if (!provider || !text || chatting.value) return
  chatInput.value = ''
  // 清空后复位输入框高度并回焦，连续对话不用再点输入框
  void nextTick(() => {
    if (composerEl.value) {
      composerEl.value.style.height = 'auto'
      composerEl.value.focus()
    }
  })
  // 多轮：把用户消息入栈，再压一个空 assistant 占位，流式追加
  messages.value.push({ role: 'user', content: text })
  messages.value.push({ role: 'assistant', content: '' })
  chatting.value = true
  scrollChatToBottom(true)
  try {
    const res = await window.api.llm.chat(
      provider,
      // 发送完整历史，但去掉末尾空 assistant 占位
      messages.value.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
      { onDelta: true },
    )
    const last = messages.value[messages.value.length - 1]
    if (last) last.content = res.content || last.content
  } catch (err) {
    const last = messages.value[messages.value.length - 1]
    if (last) { last.content = `错误：${(err as Error).message}`; last.error = true }
  } finally {
    chatting.value = false
    scrollChatToBottom()
  }
}

// 流式分片由壳统一接收并追加进 messages；这里监听末条内容变化做打字式滚动
watch(
  () => messages.value[messages.value.length - 1]?.content,
  () => scrollChatToBottom(),
)

onMounted(() => {
  // 首次进入（或切回）把输入区高度复位
  void nextTick(() => onComposerInput())
})
</script>

<template>
  <div class="chat-panel">
    <!-- 输出区：吃掉除输入区外的全部剩余空间；「回到底部」悬浮其右下 -->
    <div class="chat-main">
      <div ref="chatScroller" class="chat-scroller" @scroll="onChatScroll">
        <div v-if="!messages.length" class="chat-empty">
          <div class="chat-empty-title">对话调试</div>
          <div class="chat-empty-desc">多轮 · 流式打字 · Markdown 回显；apiKey 在主进程注入，不落渲染层</div>
        </div>
        <div v-for="(m, i) in messages" :key="i" class="chat-msg" :class="m.role">
          <div class="chat-head">
            <span class="chat-avatar" :class="m.role">
              <svg v-if="m.role === 'user'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="4" y="8" width="16" height="11" rx="2.5" />
                <path d="M12 8V4M9.5 4h5" />
                <circle cx="9" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
                <circle cx="15" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
                <path d="M2.5 13h1.5M20 13h1.5" />
              </svg>
            </span>
            <span class="chat-role">{{ m.role === 'user' ? '我' : (activeProvider ? activeProvider.model : 'AI 助手') }}</span>
          </div>
          <div class="chat-body" :class="{ error: m.error }" v-html="renderMd(m.content)"></div>
        </div>
      </div>
      <transition name="el-fade-in">
        <button v-if="!chatAutoScroll" type="button" class="chat-to-bottom" @click="scrollToBottomNow">
          ↓ 回到底部
        </button>
      </transition>
    </div>
    <!-- WorkBuddy 式统一输入区：无边框自适应 textarea + 底部工具条（模型胶囊 / 发送圆钮） -->
    <div class="composer">
      <textarea
        ref="composerEl"
        v-model="chatInput"
        class="composer-input"
        rows="1"
        :placeholder="activeProvider ? '输入测试内容，Enter 发送，Shift+Enter 换行' : '请先在下方选择模型（Provider）'"
        :disabled="!activeProvider"
        @input="onComposerInput"
        @keydown.enter.exact.prevent="sendChat"
      ></textarea>
      <div class="composer-toolbar">
        <el-select v-model="chatProviderId" class="composer-model" placeholder="选择模型（Provider）">
          <el-option v-for="p in providers" :key="p._id" :label="`${p.name} · ${p.model}`" :value="p._id" />
        </el-select>
        <button
          type="button"
          class="composer-send"
          :disabled="!activeProvider || !chatInput.trim() || chatting"
          :title="chatting ? '生成中…' : '发送（Enter）'"
          @click="sendChat"
        >
          <span v-if="chatting" class="composer-spinner" aria-hidden="true"></span>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 全高布局：页面除输入区外全部让给输出区（ToolPageLayout body flex:1 已约束） */
.chat-panel { height: 100%; display: flex; flex-direction: column; }
.chat-main { position: relative; flex: 1; min-height: 0; display: flex; }
.chat-scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 4px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.chat-empty { margin: auto; text-align: center; }
.chat-empty-title { font-size: 15px; font-weight: 600; opacity: .75; }
.chat-empty-desc { font-size: 12px; opacity: .55; margin-top: 6px; line-height: 1.6; }
.chat-msg { display: flex; flex-direction: column; max-width: 88%; }
.chat-msg.user { align-self: flex-end; align-items: flex-end; }
.chat-msg.assistant { align-self: flex-start; align-items: flex-start; }
.chat-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.chat-avatar {
  width: 22px; height: 22px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
}
.chat-avatar svg { width: 14px; height: 14px; display: block; }
.chat-avatar.user { background: var(--el-color-primary-light-8); color: var(--el-color-primary); }
.chat-avatar.assistant { background: rgba(128,128,128,.16); color: var(--el-color-info); }
.chat-role { font-size: 12px; font-weight: 600; opacity: .75; }
.chat-body {
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
  border: 1px solid rgba(128,128,128,.25);
}
.chat-msg.user .chat-body { background: var(--el-color-primary-light-9); border-color: var(--el-color-primary-light-7); }
.chat-msg.assistant .chat-body { background: rgba(128,128,128,.06); }
.chat-body.error { color: var(--el-color-danger); border-color: var(--el-color-danger); }
.chat-body :deep(p) { margin: 0 0 8px; }
.chat-body :deep(p:last-child) { margin-bottom: 0; }
.chat-body :deep(pre) {
  background: rgba(0,0,0,.08);
  border-radius: 6px;
  padding: 8px 10px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.5;
}
.chat-body :deep(code) {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
  background: rgba(0,0,0,.06);
  padding: 1px 4px;
  border-radius: 4px;
}
.chat-body :deep(pre code) { background: transparent; padding: 0; }
.chat-body :deep(ul), .chat-body :deep(ol) { margin: 0 0 8px; padding-left: 20px; }
.chat-body :deep(li) { margin: 2px 0; }
.chat-body :deep(a) { color: var(--el-color-primary); }
.chat-body :deep(table) { border-collapse: collapse; font-size: 12px; }
.chat-body :deep(th), .chat-body :deep(td) { border: 1px solid rgba(128,128,128,.3); padding: 2px 6px; }
.chat-body :deep(blockquote) { margin: 0 0 8px; padding-left: 10px; border-left: 3px solid rgba(128,128,128,.4); opacity: .8; }
/* ── WorkBuddy 式统一输入区：圆角容器 + 无边框自适应 textarea + 底部工具条 ── */
.composer {
  flex: none;
  margin-top: 10px;
  border: 1px solid rgba(128,128,128,.3);
  border-radius: 14px;
  background: var(--el-bg-color);
  padding: 12px 12px 10px;
  box-shadow: 0 2px 10px rgba(0,0,0,.06);
  transition: border-color .15s;
}
.composer:focus-within { border-color: var(--el-color-primary); }
.composer-input {
  display: block;
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--el-text-color-primary);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  min-height: 52px;
  max-height: 160px;
  overflow-y: auto;
}
.composer-input::placeholder { color: var(--el-text-color-placeholder); }
.composer-input:disabled { cursor: not-allowed; opacity: .6; }
.composer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
}
/* 模型胶囊：透明底 + 圆角描边，聚焦变主题色 */
.composer-model { max-width: 300px; }
.composer-model :deep(.el-select__wrapper) {
  border-radius: 999px;
  background: transparent;
  box-shadow: 0 0 0 1px rgba(128,128,128,.28) inset;
  min-height: 30px;
  padding: 2px 12px;
  font-size: 12px;
}
.composer-model :deep(.el-select__wrapper.is-hovering),
.composer-model :deep(.el-select__wrapper.is-focused) {
  box-shadow: 0 0 0 1px var(--el-color-primary) inset;
}
/* 发送圆钮：主题色实心，生成中转圈 */
.composer-send {
  flex: none;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: var(--el-color-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: filter .15s, transform .1s;
}
.composer-send svg { width: 16px; height: 16px; }
.composer-send:not(:disabled):hover { filter: brightness(1.12); }
.composer-send:not(:disabled):active { transform: scale(.94); }
.composer-send:disabled { background: var(--el-border-color); cursor: not-allowed; }
.composer-spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,.35);
  border-top-color: #fff;
  animation: composer-spin .8s linear infinite;
}
@keyframes composer-spin { to { transform: rotate(360deg); } }
.chat-to-bottom {
  position: absolute;
  right: 16px;
  bottom: 14px;
  z-index: 5;
  border: 1px solid var(--el-color-primary);
  background: var(--el-color-primary);
  color: #fff;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,.2);
}
.chat-to-bottom:hover { opacity: .9; }
</style>
