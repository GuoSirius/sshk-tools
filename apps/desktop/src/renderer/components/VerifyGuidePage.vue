<script setup lang="ts">
/**
 * U2 验证引导页（plans/04 §四）：可执行的检查步骤，不是静态清单搬运。
 * - 步骤数据单一来源 @sshk/shared VERIFY_STEPS（与验证清单文档同源）
 * - 自动判定优先：hostCapability 渲染层判；fileExists/catalogState/logScan 走 main verify:autoCheck
 * - 结果留痕：userData/verify-sessions/<日期>.json，下次进入续接进度；可导出 markdown 报告
 * - dev 恒显示；打包版 developerMode 开启后显示（贴合开发者自检定位）
 */
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { now } from '@sshk/shared'
import {
  VERIFY_STEPS,
  VERIFY_GROUP_LABELS,
  type VerifyGroup,
  type VerifySession,
  type VerifyStep,
  type VerifyStepResult,
} from '@sshk/shared'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'open-settings', group: string): void }>()

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const router = useRouter()

const groups = Object.keys(VERIFY_GROUP_LABELS) as VerifyGroup[]
const stepsOf = (g: VerifyGroup): VerifyStep[] => VERIFY_STEPS.filter((s) => s.group === g)

/** 会话状态 */
const session = reactive<VerifySession>({ date: '', startedAt: '', updatedAt: '', results: {} })
const lastSessionDate = ref('')
const saving = ref(false)

/** 自动判定结果：stepId → { state, detail }（挂载时并发执行） */
const autoResults = reactive<Record<string, { state: string; detail: string }>>({})
const autoRunning = ref(false)

const isDev = import.meta.env.DEV

async function loadLast(): Promise<void> {
  const dates = await window.api.verify.list()
  if (dates.length === 0) return
  const last = await window.api.verify.load()
  if (last) {
    lastSessionDate.value = last.date
    // 续接进度：历史结果并入当前会话（同 stepId 保留旧判定，用户可改）
    Object.assign(session.results, last.results)
  }
}

function todayDate(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { void persist() }, 500)
}

async function persist(): Promise<void> {
  saving.value = true
  try {
    if (!session.date) {
      session.date = todayDate()
      session.startedAt = now()
    }
    session.updatedAt = now()
    await window.api.verify.save({ ...session, results: { ...session.results } })
  } catch (err) {
    ElMessage.error(`进度保存失败：${(err as Error).message}`)
  } finally {
    saving.value = false
  }
}

function setResult(stepId: string, state: VerifyStepResult['state'] | null): void {
  if (state === null) delete session.results[stepId]
  else session.results[stepId] = { state, note: session.results[stepId]?.note ?? '', at: now() }
  scheduleSave()
}

function setNote(stepId: string, note: string): void {
  const cur = session.results[stepId]
  if (cur) session.results[stepId] = { ...cur, note }
  scheduleSave()
}

/** 自动判定结果读取（模板索引判 undefined 兜底） */
function autoOf(id: string): { state: string; detail: string } | null {
  return autoResults[id] ?? null
}

// ── 统计 ──
const passCount = computed(() => Object.values(session.results).filter((r) => r.state === 'pass').length)
const failCount = computed(() => Object.values(session.results).filter((r) => r.state === 'fail').length)
const skipCount = computed(() => Object.values(session.results).filter((r) => r.state === 'skip').length)
const judgedCount = computed(() => passCount.value + failCount.value + skipCount.value)
const groupDone = (g: VerifyGroup): number => stepsOf(g).filter((s) => session.results[s.id]?.state === 'pass').length

// ── 自动判定 ──
function hostCapabilityCheck(spec: string): { state: string; detail: string } {
  const ns = (window.api as unknown as Record<string, unknown>)[spec]
  if (ns && typeof ns === 'object') return { state: 'pass', detail: `宿主命名空间 api.${spec} 可用` }
  return { state: 'fail', detail: `宿主缺少 api.${spec} 命名空间（旧窗口？尝试一键重载）` }
}

async function runAutoChecks(): Promise<void> {
  autoRunning.value = true
  try {
    await Promise.all(VERIFY_STEPS.filter((s) => s.auto).map(async (s) => {
      if (s.auto!.kind === 'hostCapability') {
        autoResults[s.id] = hostCapabilityCheck(s.auto!.spec)
        return
      }
      try {
        autoResults[s.id] = await window.api.verify.autoCheck({ kind: s.auto!.kind, spec: s.auto!.spec })
      } catch (err) {
        autoResults[s.id] = { state: 'unknown', detail: `判定失败：${(err as Error).message}` }
      }
    }))
  } finally {
    autoRunning.value = false
  }
}

// ── 直达入口 ──
function goEntry(step: VerifyStep): void {
  if (!step.entry) return
  visible.value = false
  // 必须走 vue-router：手动改 location.hash 不触发 router 导航（曾因此按钮无反应）
  if (step.entry.type === 'route') void router.push('/tool/' + step.entry.target)
  else emit('open-settings', step.entry.target)
}

// ── 导出 markdown 报告 ──
const exporting = ref(false)
async function exportReport(): Promise<void> {
  exporting.value = true
  try {
    const lines: string[] = [
      `# sshk-tools 验证报告（${todayDate()}）`,
      '',
      `- 通过 ${passCount.value} / 未通过 ${failCount.value} / 跳过 ${skipCount.value} / 共 ${VERIFY_STEPS.length} 条`,
      `- 会话：${session.date || '（未保存）'} · 更新于 ${session.updatedAt || '—'}`,
      '',
    ]
    for (const g of groups) {
      lines.push(`## ${VERIFY_GROUP_LABELS[g]}（${groupDone(g)}/${stepsOf(g).length} 通过）`)
      lines.push('')
      for (const s of stepsOf(g)) {
        const r = session.results[s.id]
        const auto = autoResults[s.id]
        const stateText = r ? { pass: '✅ 通过', fail: '❌ 未通过', skip: '⏭️ 跳过' }[r.state] : '⬜ 未判定'
        const autoText = auto && auto.state !== 'unknown' ? `（自动判定 ${auto.state === 'pass' ? '✓' : '✗'}：${auto.detail}）` : ''
        lines.push(`- **${s.id}** ${s.title} — ${stateText}${autoText}`)
        if (r?.note) lines.push(`  - 备注：${r.note}`)
        if (r?.state === 'fail') lines.push(`  - 判定标准：${s.guide}`)
      }
      lines.push('')
    }
    const path = await window.api.os.pickSave({
      fileName: `sshk-verify-${todayDate()}.md`,
      extensions: ['md'],
    })
    if (!path) return
    await window.api.os.writeText(path, lines.join('\n'))
    ElMessage.success(`报告已导出：${path}`)
  } catch (err) {
    ElMessage.error(`导出失败：${(err as Error).message}`)
  } finally {
    exporting.value = false
  }
}

async function resetSession(): Promise<void> {
  session.date = ''
  session.startedAt = ''
  session.updatedAt = ''
  session.results = {}
  lastSessionDate.value = ''
  await persist()
  ElMessage.success('已重置，可重新开始一轮验证')
}

watch(visible, (v) => {
  if (v) {
    void loadLast().then(() => void runAutoChecks())
  }
})
</script>

<template>
  <el-dialog
    v-model="visible"
    title="验证引导（开发者自检）"
    fullscreen
    close-on-press-escape="false"
    :close-on-click-modal="false"
    class="verify-dialog"
  >
    <div class="verify-page">
      <!-- 顶部：进度 + 动作 -->
      <div class="verify-head">
        <div class="progress-line">
          <el-progress
            :percentage="VERIFY_STEPS.length === 0 ? 0 : Math.round((judgedCount / VERIFY_STEPS.length) * 100)"
            :status="failCount > 0 ? 'exception' : judgedCount === VERIFY_STEPS.length ? 'success' : undefined"
            class="progress-bar"
          />
          <span class="progress-text">
            {{ judgedCount }}/{{ VERIFY_STEPS.length }} 已判定（通过 {{ passCount }} · 未通过 {{ failCount }} · 跳过 {{ skipCount }}）
          </span>
          <span v-if="lastSessionDate" class="last-session">上次会话：{{ lastSessionDate }}</span>
          <span v-if="saving" class="saving">保存中…</span>
        </div>
        <div class="head-actions">
          <el-button size="small" :loading="autoRunning" @click="runAutoChecks">重新自动判定</el-button>
          <el-button size="small" :loading="exporting" type="primary" @click="exportReport">导出 markdown 报告</el-button>
          <el-button size="small" @click="resetSession">重置会话</el-button>
        </div>
      </div>

      <!-- 分组折叠面板 -->
      <el-collapse class="verify-groups">
        <el-collapse-item v-for="g in groups" :key="g" :name="g">
          <template #title>
            <span class="group-title">
              {{ VERIFY_GROUP_LABELS[g] }}
              <el-tag size="small" :type="groupDone(g) === stepsOf(g).length ? 'success' : 'info'" class="group-count">
                {{ groupDone(g) }}/{{ stepsOf(g).length }}
              </el-tag>
            </span>
          </template>

          <div v-for="s in stepsOf(g)" :key="s.id" class="step-card" :class="{ 'is-fail': session.results[s.id]?.state === 'fail' }">
            <div class="step-head">
              <strong class="step-id">{{ s.id }}</strong>
              <span class="step-title">{{ s.title }}</span>
              <!-- 自动判定 chip -->
              <el-tooltip v-if="autoOf(s.id)" :content="autoOf(s.id)!.detail" placement="top">
                <el-tag
                  size="small"
                  :type="autoOf(s.id)!.state === 'pass' ? 'success' : autoOf(s.id)!.state === 'fail' ? 'danger' : 'info'"
                >
                  自动：{{ autoOf(s.id)!.state === 'pass' ? '✓ 通过' : autoOf(s.id)!.state === 'fail' ? '✗ 未过' : '无法自动' }}
                </el-tag>
              </el-tooltip>
              <el-tag v-if="s.requiresPackaged" size="small" type="warning">打包版</el-tag>
              <el-button v-if="s.entry" size="small" text type="primary" class="entry-btn" @click="goEntry(s)">
                {{ s.entry.type === 'route' ? '打开工具 →' : `打开设置（${s.entry.target}）→` }}
              </el-button>
            </div>
            <div class="step-guide">{{ s.guide }}</div>
            <div v-if="s.relates" class="step-relates">关联：{{ s.relates }}</div>
            <div class="step-actions">
              <el-radio-group
                :model-value="session.results[s.id]?.state ?? null"
                size="small"
                @update:model-value="(v: string | number | boolean | undefined) => setResult(s.id, (v as VerifyStepResult['state'] | null))"
              >
                <el-radio-button :value="'pass'">通过</el-radio-button>
                <el-radio-button :value="'fail'">未通过</el-radio-button>
                <el-radio-button :value="'skip'">跳过</el-radio-button>
              </el-radio-group>
              <el-input
                :model-value="session.results[s.id]?.note ?? ''"
                size="small"
                placeholder="备注（可选：现象 / 截图路径 / 编号）"
                class="note-input"
                @update:model-value="(v: string) => setNote(s.id, v)"
              />
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>

      <div v-if="isDev" class="dev-hint">当前为 dev 环境：C1-C3 / E3 / E-V7 / F-T1 / F-T2 等标「打包版」的条目需打包版验证。</div>
    </div>
  </el-dialog>
</template>

<style scoped>
.verify-page { padding: 0 8px 24px; }
.verify-head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
.progress-line { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 320px; }
.progress-bar { flex: 1; }
.progress-text { white-space: nowrap; font-size: 13px; }
.last-session, .saving { font-size: 12px; opacity: 0.65; white-space: nowrap; }
.head-actions { display: flex; gap: 8px; }
.group-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }
.group-count { margin-left: 4px; }
.step-card { border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
.step-card.is-fail { border-color: var(--el-color-danger-light-5); background: var(--el-color-danger-light-9); }
.step-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.step-id { color: var(--el-color-primary); min-width: 56px; }
.step-title { flex: 1; min-width: 200px; }
.entry-btn { margin-left: auto; }
.step-guide { font-size: 12px; opacity: 0.75; margin: 6px 0 4px 64px; }
.step-relates { font-size: 11px; opacity: 0.5; margin-left: 64px; }
.step-actions { display: flex; align-items: center; gap: 12px; margin-top: 8px; margin-left: 64px; }
.note-input { max-width: 420px; }
.dev-hint { margin-top: 8px; font-size: 12px; opacity: 0.6; }
</style>
