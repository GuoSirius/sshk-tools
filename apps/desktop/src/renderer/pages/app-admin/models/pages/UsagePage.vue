<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { format, toFileName } from '@sshk/shared'
import type { UsageStatsPayload, UsageRow } from '@sshk/shared'
// 图标约定（2026-11-17）：优先 @element-plus/icons-vue / FontAwesome，均无再用自定义 SVG
import { Download, Refresh } from '@element-plus/icons-vue'
import { ListPageShell, ListPagination } from '@sshk/ui-kit'
import { host } from '../host'

/**
 * D-Q1 用量统计页（P4-5 迁即重构）：统计页列表部分套 ListPageShell 外壳——
 * 筛选栏=时间范围，操作栏=导出 CSV/清空/刷新，表格区=汇总条+分组汇总+最近明细，分页=明细 ListPagination。
 * 数据来自 usage.db（main 侧 llm 返回钩子记录），只含元数据，不含 messages 内容。
 */

const RANGES = [
  { label: '今天', days: 1 },
  { label: '最近 7 天', days: 7 },
  { label: '最近 30 天', days: 30 },
  { label: '全部', days: 0 },
] as const
const rangeDays = ref<number>(7)
const loading = ref(false)
const data = ref<UsageStatsPayload | null>(null)

// ── 明细分页（客户端切片；明细上限 200 条，完整数据走导出 CSV）──
const page = ref(1)
const pageSize = ref(20)
const records = computed<UsageRow[]>(() => data.value?.records ?? [])
const pagedRecords = computed(() => records.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

async function refresh(): Promise<void> {
  loading.value = true
  try {
    // since 用北京时间 YYYY-MM-DD 00:00 前缀过滤（createdAt 字符串有序，前缀比较即时间过滤）
    const days = rangeDays.value
    const since = days > 0
      ? `${format(Date.now() - (days - 1) * 86_400_000, 'YYYY-MM-DD')}T00:00:00`
      : null
    data.value = await host.usage.stats(since)
    page.value = 1
  } catch (err) {
    ElMessage.error(`用量统计加载失败：${(err as Error).message}`)
  } finally {
    loading.value = false
  }
}
onMounted(() => { void refresh() })

const totals = computed(() => {
  const groups = data.value?.groups ?? []
  return {
    calls: groups.reduce((acc, g) => acc + g.calls, 0),
    failCalls: groups.reduce((acc, g) => acc + g.failCalls, 0),
    promptTokens: groups.reduce((acc, g) => acc + g.promptTokens, 0),
    completionTokens: groups.reduce((acc, g) => acc + g.completionTokens, 0),
    avgMs: (() => {
      const calls = groups.reduce((acc, g) => acc + g.calls, 0)
      const ms = groups.reduce((acc, g) => acc + g.totalMs, 0)
      return calls ? Math.round(ms / calls) : 0
    })(),
  }
})

const PURPOSE_LABEL: Record<string, string> = {
  console: '对话调试',
  tool: '工具调用',
  vision: '视觉识别',
}
const purposeLabel = (p: string): string => PURPOSE_LABEL[p] ?? p

function fmtNum(n: number): string {
  return new Intl.NumberFormat('zh-CN').format(n) // P0-3：数字千分位走 Intl.NumberFormat（toLocaleString 已禁）
}

/** 导出 CSV（列含 BOM，Excel 直开不乱码） */
async function exportCsv(): Promise<void> {
  const rows = records.value
  if (!rows.length) { ElMessage.warning('当前范围没有明细可导出'); return }
  const save = await host.os.pickSave({
    fileName: `sshk-usage-${toFileName()}.csv`,
    extensions: ['csv'],
  })
  if (!save) return
  const head = '时间,用途,Provider,模型,流式,promptTokens,completionTokens,耗时ms,成功,错误'
  const lines = rows.map((r) => [
    r.createdAt,
    purposeLabel(r.purpose),
    r.providerName,
    r.model,
    r.streamed ? '是' : '否',
    String(r.promptTokens ?? ''),
    String(r.completionTokens ?? ''),
    String(r.durationMs),
    r.ok ? '是' : '否',
    r.error ? `"${r.error.replaceAll('"', '""')}"` : '',
  ].join(','))
  const csv = '\uFEFF' + [head, ...lines].join('\n')
  await host.os.writeText(save, csv)
  ElMessage.success(`已导出 ${rows.length} 条明细：${save}`)
}

async function clearAll(): Promise<void> {
  try {
    await ElMessageBox.confirm('确定清空全部用量明细？该操作不可恢复（不影响 Provider 配置与密钥）', '清空用量', {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      closeOnClickModal: false,
      closeOnPressEscape: false,
    })
    const { removed } = await host.usage.clear(0)
    ElMessage.success(`已清空 ${removed} 条用量明细`)
    await refresh()
  } catch { /* 取消 */ }
}
</script>

<template>
  <ListPageShell :loading="loading">
    <template #filter>
      <div class="f-item">
        <span class="f-label">时间范围</span>
        <el-radio-group v-model="rangeDays" size="small" @change="refresh">
          <el-radio-button v-for="r in RANGES" :key="r.days" :value="r.days">{{ r.label }}</el-radio-button>
        </el-radio-group>
      </div>
    </template>

    <template #ops>
      <el-button size="small" type="success" plain :icon="Download" :disabled="!records.length" @click="exportCsv">导出 CSV</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" type="danger" plain @click="clearAll">清空用量</el-button>
      <el-divider direction="vertical" />
      <el-button size="small" plain :icon="Refresh" :loading="loading" @click="refresh">刷新</el-button>
    </template>

    <!-- 统计页表格区：汇总条 + 分组汇总 + 最近明细 整体滚动（.lp-table 只撑高度不滚动，内层滚动容器承接） -->
    <div class="usage-scroll">
      <div class="usage-summary">
        <div class="usage-stat"><span class="usage-stat-num">{{ fmtNum(totals.calls) }}</span><span class="usage-stat-label">调用次数</span></div>
        <div class="usage-stat"><span class="usage-stat-num" :class="{ bad: totals.failCalls > 0 }">{{ fmtNum(totals.failCalls) }}</span><span class="usage-stat-label">失败次数</span></div>
        <div class="usage-stat"><span class="usage-stat-num">{{ fmtNum(totals.promptTokens) }}</span><span class="usage-stat-label">prompt tokens</span></div>
        <div class="usage-stat"><span class="usage-stat-num">{{ fmtNum(totals.completionTokens) }}</span><span class="usage-stat-label">completion tokens</span></div>
        <div class="usage-stat"><span class="usage-stat-num">{{ totals.avgMs }}ms</span><span class="usage-stat-label">平均耗时</span></div>
      </div>

      <!-- 分组汇总表 -->
      <el-table :data="data?.groups ?? []" size="small">
        <el-table-column prop="providerName" label="Provider" min-width="140" />
        <el-table-column prop="model" label="模型" min-width="180" show-overflow-tooltip />
        <el-table-column label="调用" width="90"><template #default="{ row }">{{ fmtNum(row.calls) }}</template></el-table-column>
        <el-table-column label="失败" width="90">
          <template #default="{ row }"><span :class="{ 'usage-bad': row.failCalls > 0 }">{{ fmtNum(row.failCalls) }}</span></template>
        </el-table-column>
        <el-table-column label="prompt" width="110"><template #default="{ row }">{{ fmtNum(row.promptTokens) }}</template></el-table-column>
        <el-table-column label="completion" width="120"><template #default="{ row }">{{ fmtNum(row.completionTokens) }}</template></el-table-column>
        <el-table-column label="平均耗时" width="110">
          <template #default="{ row }">{{ row.calls ? `${Math.round(row.totalMs / row.calls)}ms` : '—' }}</template>
        </el-table-column>
      </el-table>
      <div v-if="data && data.groups.length === 0 && !loading" class="usage-empty">当前范围暂无调用记录</div>

      <!-- 最近明细 -->
      <div class="usage-detail-title">最近明细（最多 200 条，完整数据可导出 CSV）</div>
      <el-table :data="pagedRecords" size="small">
        <el-table-column type="index" label="#" width="50" align="center" :index="(i: number) => (page - 1) * pageSize + i + 1" />
        <el-table-column prop="createdAt" label="时间" width="170" />
        <el-table-column label="用途" width="90">
          <template #default="{ row }">{{ purposeLabel(row.purpose) }}</template>
        </el-table-column>
        <el-table-column prop="model" label="模型" min-width="170" show-overflow-tooltip />
        <el-table-column label="流式" width="60">
          <template #default="{ row }">{{ row.streamed ? '是' : '否' }}</template>
        </el-table-column>
        <el-table-column label="completion" width="110">
          <template #default="{ row }">{{ row.completionTokens != null ? fmtNum(row.completionTokens) : '—' }}</template>
        </el-table-column>
        <el-table-column label="耗时" width="90">
          <template #default="{ row }">{{ row.durationMs }}ms</template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="row.ok ? 'success' : 'danger'">{{ row.ok ? '成功' : '失败' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="错误" min-width="160" show-overflow-tooltip>
          <template #default="{ row }"><span class="usage-bad">{{ row.error ?? '' }}</span></template>
        </el-table-column>
      </el-table>
    </div>

    <template #footer>
      <ListPagination v-model:page="page" v-model:pageSize="pageSize" :total="records.length" :page-sizes="[20, 50, 100]" />
    </template>
  </ListPageShell>
</template>

<style scoped>
/* .lp-table 只撑高度不滚动：统计页内容整体放内层滚动容器 */
.usage-scroll { height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; }
.usage-summary { display: flex; gap: 10px; flex-wrap: wrap; }
.usage-stat {
  flex: 1; min-width: 120px;
  border: 1px solid rgba(128,128,128,.22);
  border-radius: 10px;
  padding: 10px 14px;
  display: flex; flex-direction: column; gap: 2px;
  background: rgba(128,128,128,.05);
}
.usage-stat-num { font-size: 20px; font-weight: 700; }
.usage-stat-num.bad { color: var(--el-color-danger); }
.usage-stat-label { font-size: 11px; opacity: .6; }
.usage-bad { color: var(--el-color-danger); }
.usage-empty { text-align: center; font-size: 12px; opacity: .55; padding: 18px 0; }
.usage-detail-title { font-size: 13px; font-weight: 600; opacity: .8; }
</style>
