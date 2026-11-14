<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { EmptyState, TimeText } from '@sshk/ui-kit'
import { brands, loadBrands } from '../state'
import { api, confirmRemove, isSystem, type BrandRow } from '../shared'

/** 品牌页（D29 独立管理） */
const brandOpen = ref(false)
const brandForm = ref<{ _id: string; code: string; name: string }>({ _id: '', code: '', name: '' })

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
</script>

<template>
  <div>
    <el-button type="primary" size="small" @click="openBrand()">新增品牌</el-button>
    <el-table v-if="brands.length > 0" :data="brands" size="small" style="margin-top: 8px">
      <el-table-column prop="code" label="code" width="140" />
      <el-table-column prop="name" label="名称" min-width="160">
        <template #default="{ row }">
          {{ row.name }}
          <el-tag v-if="isSystem(row)" size="small" type="info" style="margin-left: 6px">系统</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="160">
        <template #default="{ row }"><TimeText :value="row.createdAt" /></template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <template v-if="!isSystem(row)">
            <el-button size="small" text @click="openBrand(row)">编辑</el-button>
            <el-button size="small" text type="danger" @click="confirmRemove('删除品牌', row.name, async () => { await api('brand:remove', { _id: row._id }); await loadBrands() })">删除</el-button>
          </template>
          <span v-else style="font-size: 12px; opacity: 0.6">内置只读</span>
        </template>
      </el-table-column>
    </el-table>
    <EmptyState v-else style="margin-top: 8px" description="还没有品牌；品牌是模板与片段的归属单位" action-text="新增品牌" @action="openBrand()" />

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
