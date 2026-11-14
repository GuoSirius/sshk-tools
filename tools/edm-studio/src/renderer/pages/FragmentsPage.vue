<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { fragments, brands, loadFragments } from '../state'
import { api, confirmRemove, type Named, type VersionRow } from '../shared'

/** 片段页：片段族 + 版本（黑名单优先，D14） */
const frgOpen = ref(false)
const frgForm = ref<{ _id: string; brandId: string; name: string; type: string }>({ _id: '', brandId: '', name: '', type: 'product' })
const frgvOpen = ref(false)
const frgvForm = ref<{ fragmentId: string; prevVersionId: string; html: string; blacklistText: string; whitelistText: string }>({ fragmentId: '', prevVersionId: '', html: '', blacklistText: '', whitelistText: '' })

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
    const split = (t: string): string[] => t.split(/[\s,，]+/).filter(Boolean)
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
</script>

<template>
  <div>
    <el-button size="small" @click="openFrg()">新增片段</el-button>

    <el-table :data="fragments" size="small" style="margin-top: 8px">
      <el-table-column type="index" label="#" width="50" align="center" />
      <el-table-column prop="name" label="片段" min-width="140" />
      <el-table-column prop="type" label="槽位类型" width="110" />
      <el-table-column label="品牌" min-width="120">
        <template #default="{ row }">{{ brands.find((b) => b._id === row.brandId)?.name ?? row.brandId }}</template>
      </el-table-column>
      <el-table-column label="操作" width="190" fixed="right">
        <template #default="{ row }">
          <el-button size="small" text @click="openFrgv(row)">新建版本</el-button>
          <el-button size="small" text @click="openFrg(row)">编辑</el-button>
          <el-button size="small" text type="danger" @click="confirmRemove('删除片段', String(row.name), async () => { await api('frg:remove', { _id: row._id }); await loadFragments() })">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

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
