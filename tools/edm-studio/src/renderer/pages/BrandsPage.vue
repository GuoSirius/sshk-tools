<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { EmptyState, TimeText } from '@sshk/ui-kit'
import { brands, loadBrands } from '../state'
import { api, confirmRemove, isSystem, type BrandRow } from '../shared'

/** 品牌管理页（表格/操作约定）：三段式 + # 跨页序号 + 选择列 + 批量删除 + 操作列 ≤3、删除进「更多」 */
const brandOpen = ref(false)
const brandForm = ref<{ _id: string; code: string; name: string }>({ _id: '', code: '', name: '' })

const currentPage = ref(1)
const pageSize = ref(10)
const pagedBrands = computed(() => brands.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value))

const selectedBrands = ref<BrandRow[]>([])
function onSelectionChange(rows: BrandRow[]): void { selectedBrands.value = rows }

function openBrand(row?: BrandRow): void {
  brandForm.value = row ? { _id: row._id, code: row.code, name: row.name } : { _id: '', code: '', name: '' }
  brandOpen.value = true
}
async function saveBrand(): Promise<void> {
  try {
    await api('brand:save', brandForm.value)
    brandOpen.value = false
    await loadBrands()
    ElMessage.success('品牌已保存')
  } catch (err) { ElMessage.error((err as Error).message) }
}

/** 批量删除（批量约定）：系统内置行自动跳过 */
async function batchRemove(): Promise<void> {
  const rows = selectedBrands.value
  if (rows.length === 0) { ElMessage.warning('请先勾选要删除的品牌'); return }
  const removable = rows.filter((row) => !isSystem(row))
  if (removable.length === 0) { ElMessage.warning('所选品牌均为系统内置（只读），已跳过'); return }
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${removable.length} 个品牌？记录将归档。`, '批量删除', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch { return }
  for (const row of removable) await api('brand:remove', { _id: row._id })
  await loadBrands()
  ElMessage.success(`已删除 ${removable.length} 个品牌`)
}

async function onRowCommand(cmd: string, row: BrandRow): Promise<void> {
  if (cmd === 'delete') await confirmRemove('删除品牌', row.name, async () => { await api('brand:remove', { _id: row._id }); await loadBrands() })
}
</script>

<template>
  <div class="brands-page">
    <div class="toolbar">
      <el-button size="small" type="primary" plain @click="openBrand()">新增品牌</el-button>
      <el-button size="small" type="danger" plain :disabled="selectedBrands.length === 0" @click="batchRemove">批量删除（{{ selectedBrands.length }}）</el-button>
    </div>

    <div class="table-wrap">
      <el-table v-if="brands.length > 0" :data="pagedBrands" size="small" row-key="_id" height="100%" @selection-change="onSelectionChange">
        <el-table-column type="index" label="#" width="46" align="center" :index="(i: number) => (currentPage - 1) * pageSize + i + 1" />
        <el-table-column type="selection" width="40" reserve-selection />
        <el-table-column prop="code" label="code" width="140" show-overflow-tooltip />
        <el-table-column label="名称" min-width="160">
          <template #default="{ row }">
            {{ row.name }}
            <el-tag v-if="isSystem(row)" size="small" type="info" style="margin-left: 6px">系统</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="160">
          <template #default="{ row }"><TimeText :value="row.createdAt" /></template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center" fixed="right">
          <template #default="{ row }">
            <div v-if="!isSystem(row)" class="op-row">
              <el-button size="small" type="primary" plain @click="openBrand(row)">编辑</el-button>
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
      <EmptyState v-else description="还没有品牌；品牌是模板与片段的归属单位" action-text="新增品牌" @action="openBrand()" />
    </div>

    <div class="foot">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="brands.length"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        small
      />
    </div>

    <el-dialog :close-on-click-modal="false" :close-on-press-escape="false" v-model="brandOpen" :title="brandForm._id ? '编辑品牌' : '新增品牌'" width="400px">
      <el-form label-width="70px" size="small">
        <el-form-item label="code"><el-input v-model="brandForm.code" placeholder="procell" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="brandForm.name" placeholder="Procell" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="brandOpen = false">取消</el-button>
        <el-button size="small" type="primary" @click="saveBrand">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.brands-page { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.toolbar { flex: none; display: flex; gap: 8px; align-items: center; }
.table-wrap { flex: 1; min-height: 0; margin-top: 8px; }
.foot { flex: none; display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.op-row { display: flex; gap: 6px; justify-content: center; align-items: center; }
.op-row .el-button + .el-button { margin-left: 0; }
</style>
