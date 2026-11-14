<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { EmptyState } from '@sshk/ui-kit'
import { fragments, brands, loadFragments } from '../state'
import { api, confirmRemove, isSystem, type Named, type VersionRow } from '../shared'

/** 片段管理页（表格/操作约定）：三段式 + # 跨页序号 + 选择列 + 批量删除 + 操作列 ≤3、删除进「更多」；黑白名单随版本创建（D14） */
const frgOpen = ref(false)
const frgForm = ref<{ _id: string; brandId: string; name: string; type: string }>({ _id: '', brandId: '', name: '', type: 'product' })
const frgvOpen = ref(false)
const frgvForm = ref<{ fragmentId: string; prevVersionId: string; html: string; blacklistText: string; whitelistText: string }>({ fragmentId: '', prevVersionId: '', html: '', blacklistText: '', whitelistText: '' })

const currentPage = ref(1)
const pageSize = ref(10)
const pagedFragments = computed(() => fragments.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value))

const selectedFrgs = ref<Named[]>([])
function onSelectionChange(rows: Named[]): void { selectedFrgs.value = rows }

function openFrg(row?: Named): void {
  frgForm.value = row
    ? { _id: row._id, brandId: String(row.brandId ?? ''), name: String(row.name ?? ''), type: String(row.type ?? 'product') }
    : { _id: '', brandId: brands.value[0]?._id ?? '', name: '', type: 'product' }
  frgOpen.value = true
}
async function saveFrg(): Promise<void> {
  try {
    await api('frg:save', frgForm.value)
    frgOpen.value = false
    await loadFragments()
    ElMessage.success('片段已保存')
  } catch (err) { ElMessage.error((err as Error).message) }
}
function openFrgv(row?: Named): void {
  if (!row) {
    ElMessage.warning('先在列表选择片段族（行内「新建版本」）')
    return
  }
  frgvForm.value = {
    fragmentId: row._id,
    prevVersionId: '',
    html: String((row as VersionRow | undefined)?.source?.html ?? '<div class="product-card">{{ title }}</div>'),
    blacklistText: '',
    whitelistText: '',
  }
  frgvOpen.value = true
}
async function saveFrgv(): Promise<void> {
  try {
    const split = (t: string): string[] => t.split(/[,，、]+/).map((s) => s.trim()).filter(Boolean)
    await api('frgv:save', {
      fragmentId: frgvForm.value.fragmentId,
      prevVersionId: frgvForm.value.prevVersionId,
      source: { html: frgvForm.value.html, cssMode: 'inline' },
      policy: { blacklist: split(frgvForm.value.blacklistText), whitelist: split(frgvForm.value.whitelistText) },
    })
    frgvOpen.value = false
    ElMessage.success('片段版本已创建（黑名单优先，D14）')
  } catch (err) { ElMessage.error((err as Error).message) }
}

/** 批量删除（批量约定）：系统内置行自动跳过 */
async function batchRemove(): Promise<void> {
  const rows = selectedFrgs.value
  if (rows.length === 0) { ElMessage.warning('请先勾选要删除的片段'); return }
  const removable = rows.filter((row) => !isSystem(row))
  if (removable.length === 0) { ElMessage.warning('所选片段均为系统内置（只读），已跳过'); return }
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${removable.length} 个片段？记录将归档。`, '批量删除', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch { return }
  for (const row of removable) await api('frg:remove', { _id: row._id })
  await loadFragments()
  ElMessage.success(`已删除 ${removable.length} 个片段`)
}

async function onRowCommand(cmd: string, row: Named): Promise<void> {
  if (cmd === 'delete') await confirmRemove('删除片段', String(row.name), async () => { await api('frg:remove', { _id: row._id }); await loadFragments() })
}
</script>

<template>
  <div class="frags-page">
    <div class="toolbar">
      <el-button size="small" type="primary" plain @click="openFrg()">新增片段</el-button>
      <span class="spacer" />
      <el-button size="small" type="danger" plain :disabled="selectedFrgs.length === 0" @click="batchRemove">批量删除（{{ selectedFrgs.length }}）</el-button>
    </div>

    <div class="table-wrap">
      <el-table v-if="fragments.length > 0" :data="pagedFragments" size="small" row-key="_id" height="100%" @selection-change="onSelectionChange">
        <el-table-column type="index" label="#" width="46" align="center" :index="(i: number) => (currentPage - 1) * pageSize + i + 1" />
        <el-table-column type="selection" width="40" reserve-selection />
        <el-table-column label="片段" min-width="140">
          <template #default="{ row }">
            {{ row.name }}
            <el-tag v-if="isSystem(row)" size="small" type="info" style="margin-left: 6px">系统</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="type" label="槽位类型" width="110" />
        <el-table-column label="品牌" min-width="120">
          <template #default="{ row }">{{ brands.find((b) => b._id === row.brandId)?.name ?? row.brandId }}</template>
        </el-table-column>
        <el-table-column label="操作" width="190" align="center" fixed="right">
          <template #default="{ row }">
            <div v-if="!isSystem(row)" class="op-row">
              <el-button size="small" type="primary" plain @click="openFrgv(row)">新建版本</el-button>
              <el-button size="small" type="success" plain @click="openFrg(row)">编辑</el-button>
              <el-dropdown trigger="click" @command="(cmd: string) => onRowCommand(cmd, row)">
                <el-button size="small" plain>更多</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="delete" style="color: var(--el-color-danger)">删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
            <span v-else style="font-size: 12px; opacity: 0.6">内置只读</span>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState v-else description="还没有片段；片段按槽位类型（header/product/footer）供模板绑定" action-text="新增片段" @action="openFrg()" />
    </div>

    <div class="foot">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="fragments.length"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        small
      />
    </div>

    <el-dialog :close-on-click-modal="false" :close-on-press-escape="false" v-model="frgOpen" :title="frgForm._id ? '编辑片段' : '新增片段'" width="460px">
      <el-form label-width="70px" size="small">
        <el-form-item label="品牌">
          <el-select v-model="frgForm.brandId" style="width: 100%">
            <el-option v-for="b in brands" :key="b._id" :label="b.name" :value="b._id" />
          </el-select>
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="frgForm.name" /></el-form-item>
        <el-form-item label="类型">
          <el-select v-model="frgForm.type" style="width: 100%">
            <el-option label="banner（头图）" value="banner" />
            <el-option label="product（产品）" value="product" />
            <el-option label="footer（页脚）" value="footer" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="frgOpen = false">取消</el-button>
        <el-button size="small" type="primary" @click="saveFrg">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog :close-on-click-modal="false" :close-on-press-escape="false" v-model="frgvOpen" title="新建片段版本（含黑白名单）" width="640px">
      <el-input v-model="frgvForm.html" type="textarea" :rows="8" placeholder="njk 源码" />
      <div style="margin-top: 8px; display: flex; gap: 8px">
        <el-input v-model="frgvForm.blacklistText" size="small" placeholder="黑名单（模板/版本 ID，逗号分隔）" />
        <el-input v-model="frgvForm.whitelistText" size="small" placeholder="白名单（空 = 不限制）" />
      </div>
      <template #footer>
        <el-button size="small" @click="frgvOpen = false">取消</el-button>
        <el-button size="small" type="primary" @click="saveFrgv">创建版本</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.frags-page { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.toolbar { flex: none; display: flex; gap: 8px; align-items: center; }
.toolbar .spacer { flex: 1; }
.table-wrap { flex: 1; min-height: 0; margin-top: 8px; }
.foot { flex: none; display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.op-row { display: flex; gap: 6px; justify-content: center; align-items: center; }
.op-row .el-button + .el-button { margin-left: 0; }
</style>
