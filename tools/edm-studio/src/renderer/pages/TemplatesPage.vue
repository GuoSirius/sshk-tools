<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { EmptyState, TimeText } from '@sshk/ui-kit'
import { brands, currentTpl, loadTemplates, selectTemplate, templates, tplVersions } from '../state'
import { api, confirmRemove, isSystem, type Named, type VersionRow } from '../shared'

/** 模板管理页（表格/操作约定）：三段式 + # 跨页序号 + 选择列 + 批量删除 + 操作列 ≤3、删除/复制进「更多」 */
const tplOpen = ref(false)
const tplForm = ref<{ _id: string; brandId: string; name: string; description: string }>({ _id: '', brandId: '', name: '', description: '' })
const tplvOpen = ref(false)
const tplvForm = ref<{ templateId: string; prevVersionId: string; html: string; sampleDataText: string }>({ templateId: '', prevVersionId: '', html: '', sampleDataText: '{}' })

const currentPage = ref(1)
const pageSize = ref(10)
const pagedTemplates = computed(() => templates.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value))

const selectedTpls = ref<Named[]>([])
function onSelectionChange(rows: Named[]): void { selectedTpls.value = rows }

function openTpl(row?: Named): void {
  tplForm.value = row
    ? { _id: row._id, brandId: String(row.brandId ?? ''), name: String(row.name ?? ''), description: String(row.description ?? '') }
    : { _id: '', brandId: brands.value[0]?._id ?? '', name: '', description: '' }
  tplOpen.value = true
}
async function saveTpl(): Promise<void> {
  try {
    await api('tpl:save', tplForm.value)
    tplOpen.value = false
    await loadTemplates()
    ElMessage.success('模板已保存')
  } catch (err) { ElMessage.error((err as Error).message) }
}

/** 复制派生（复制约定）：基于该族最新版本另存为新模板副本（D8 不可变，复制即新建） */
async function deriveTpl(row: Named): Promise<void> {
  try {
    const res = (await api('tplv:saveAsNew', {
      _id: String(row.latestVersionId ?? ''),
      name: `${row.name} 副本`,
      brandId: String(row.brandId ?? ''),
    })) as { template: Named }
    await loadTemplates()
    await selectTemplate(res.template)
    ElMessage.success('已派生为自定义模板副本')
  } catch (err) { ElMessage.error((err as Error).message) }
}

function openTplv(row?: VersionRow): void {
  if (!currentTpl.value) {
    ElMessage.warning('先选择模板族')
    return
  }
  tplvForm.value = {
    templateId: currentTpl.value._id,
    prevVersionId: row?._id ?? '',
    html: String(row?.source?.html ?? '<table><tr><td>{{ slot_header | safe }}</td><td>{{ slot_body | safe }}</td></tr></table>'),
    sampleDataText: JSON.stringify(row?.sampleData ?? {}, null, 2),
  }
  tplvOpen.value = true
}
async function saveTplv(): Promise<void> {
  try {
    const sampleData = JSON.parse(tplvForm.value.sampleDataText) as Record<string, unknown>
    await api('tplv:save', {
      templateId: tplvForm.value.templateId,
      prevVersionId: tplvForm.value.prevVersionId,
      source: { html: tplvForm.value.html, cssMode: 'inline' },
      slots: [{ key: 'header', type: 'banner' }, { key: 'body', type: 'product' }, { key: 'footer', type: 'footer' }],
      sampleData,
    })
    tplvOpen.value = false
    await selectTemplate(currentTpl.value!)
    ElMessage.success('新版本已创建（版本不可变，D8）')
  } catch (err) { ElMessage.error((err as Error).message) }
}

async function saveTplAsNew(row: VersionRow): Promise<void> {
  try {
    const res = await api('tplv:saveAsNew', {
      _id: row._id,
      name: `${currentTpl.value?.name ?? ''} ${row.label ?? ''} 副本`,
      brandId: String(currentTpl.value?.brandId ?? ''),
    }) as { template: Named }
    await loadTemplates()
    await selectTemplate(res.template)
    ElMessage.success('系统模板已派生为自定义副本（版本不可变，D8）')
  } catch (err) { ElMessage.error((err as Error).message) }
}

/** 批量删除（批量约定）：系统内置行自动跳过 */
async function batchRemove(): Promise<void> {
  const rows = selectedTpls.value
  if (rows.length === 0) { ElMessage.warning('请先勾选要删除的模板'); return }
  const removable = rows.filter((row) => !isSystem(row))
  if (removable.length === 0) { ElMessage.warning('所选模板均为系统内置（只读），已跳过'); return }
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${removable.length} 个模板？记录将归档。`, '批量删除', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch { return }
  for (const row of removable) await api('tpl:remove', { _id: row._id })
  await loadTemplates()
  ElMessage.success(`已删除 ${removable.length} 个模板`)
}

async function onRowCommand(cmd: string, row: Named): Promise<void> {
  if (cmd === 'delete') await confirmRemove('删除模板', String(row.name), async () => { await api('tpl:remove', { _id: row._id }); await loadTemplates() })
  if (cmd === 'derive') await deriveTpl(row)
}
</script>

<template>
  <div class="tpls-page">
    <div class="toolbar">
      <el-button size="small" type="primary" plain @click="openTpl()">新增模板</el-button>
      <el-button v-if="!currentTpl || !isSystem(currentTpl)" size="small" type="success" plain @click="openTplv()">新建版本</el-button>
      <span v-else class="sys-hint">系统模板只读：版本行「另存为副本」派生后可编辑</span>
      <span class="spacer" />
      <el-button size="small" type="danger" plain :disabled="selectedTpls.length === 0" @click="batchRemove">批量删除（{{ selectedTpls.length }}）</el-button>
    </div>

    <div class="table-wrap">
      <el-table
        v-if="templates.length > 0"
        :data="pagedTemplates"
        size="small"
        row-key="_id"
        height="100%"
        highlight-current-row
        @selection-change="onSelectionChange"
        @row-click="selectTemplate"
      >
        <el-table-column type="index" label="#" width="46" align="center" :index="(i: number) => (currentPage - 1) * pageSize + i + 1" />
        <el-table-column type="selection" width="40" reserve-selection />
        <el-table-column label="模板" min-width="160">
          <template #default="{ row }">
            {{ row.name }}
            <el-tag v-if="isSystem(row)" size="small" type="info" style="margin-left: 6px">系统</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="品牌" min-width="120">
          <template #default="{ row }">{{ brands.find((b) => b._id === row.brandId)?.name ?? row.brandId }}</template>
        </el-table-column>
        <el-table-column label="创建时间" width="160">
          <template #default="{ row }"><TimeText :value="row.createdAt" /></template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center" fixed="right">
          <template #default="{ row }">
            <div v-if="!isSystem(row)" class="op-row">
              <el-button size="small" type="primary" plain @click="openTpl(row)">编辑</el-button>
              <el-dropdown trigger="click" @command="(cmd: string) => onRowCommand(cmd, row)">
                <el-button size="small" plain>更多</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="derive">复制派生副本</el-dropdown-item>
                    <el-dropdown-item command="delete" style="color: var(--el-color-danger)">删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
            <span v-else style="font-size: 12px; opacity: 0.6">内置只读</span>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState v-else description="还没有模板；模板族声明槽位，版本承载内容（不可变）" />
    </div>

    <div v-if="currentTpl" class="panel">
      <div class="panel-title">「{{ currentTpl.name }}」版本（不可变，保存即新版本）</div>
      <el-table :data="tplVersions" size="small">
        <el-table-column prop="label" label="版本" width="80" />
        <el-table-column label="创建时间" width="160">
          <template #default="{ row }"><TimeText :value="row.createdAt" /></template>
        </el-table-column>
        <el-table-column label="操作">
          <template #default="{ row }">
            <el-button v-if="currentTpl && !isSystem(currentTpl)" size="small" text type="primary" plain @click="openTplv(row)">基于此版本修改</el-button>
            <el-button v-else size="small" text type="success" plain @click="saveTplAsNew(row)">另存为副本</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="foot">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="templates.length"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        small
      />
    </div>

    <el-dialog :close-on-click-modal="false" :close-on-press-escape="false" v-model="tplOpen" :title="tplForm._id ? '编辑模板' : '新增模板'" width="460px">
      <el-form label-width="70px" size="small">
        <el-form-item label="品牌">
          <el-select v-model="tplForm.brandId" style="width: 100%">
            <el-option v-for="b in brands" :key="b._id" :label="b.name" :value="b._id" />
          </el-select>
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="tplForm.name" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="tplForm.description" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="tplOpen = false">取消</el-button>
        <el-button size="small" type="primary" @click="saveTpl">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog :close-on-click-modal="false" :close-on-press-escape="false" v-model="tplvOpen" title="新建模板版本（不可变）" width="640px">
      <el-input v-model="tplvForm.html" type="textarea" :rows="10" placeholder="njk 源码；槽位用 {{ slot_header | safe }} 等引用" />
      <el-input v-model="tplvForm.sampleDataText" type="textarea" :rows="4" style="margin-top: 8px" placeholder="sampleData JSON" />
      <template #footer>
        <el-button size="small" @click="tplvOpen = false">取消</el-button>
        <el-button size="small" type="primary" @click="saveTplv">创建版本</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.tpls-page { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.toolbar { flex: none; display: flex; gap: 8px; align-items: center; }
.toolbar .spacer { flex: 1; }
.sys-hint { font-size: 12px; opacity: 0.65; }
.table-wrap { flex: 1; min-height: 0; margin-top: 8px; }
.panel { flex: none; border: 1px solid rgba(128, 128, 128, 0.25); border-radius: 6px; padding: 10px; margin-top: 8px; max-height: 30%; overflow: auto; }
.panel-title { font-size: 12px; opacity: 0.7; margin-bottom: 8px; }
.foot { flex: none; display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.op-row { display: flex; gap: 6px; justify-content: center; align-items: center; }
.op-row .el-button + .el-button { margin-left: 0; }
</style>
