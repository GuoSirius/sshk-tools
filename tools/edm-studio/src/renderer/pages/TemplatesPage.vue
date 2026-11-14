<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { TimeText } from '@sshk/ui-kit'
import { brands, currentTpl, loadTemplates, selectTemplate, templates, tplVersions } from '../state'
import { api, confirmRemove, type Named, type VersionRow } from '../shared'

/** 模板页：模板族列表 + 版本（不可变，保存即新版本，D8） */
const tplOpen = ref(false)
const tplForm = ref<{ _id: string; brandId: string; name: string; description: string }>({ _id: '', brandId: '', name: '', description: '' })
const tplvOpen = ref(false)
const tplvForm = ref<{ templateId: string; prevVersionId: string; html: string; sampleDataText: string }>({ templateId: '', prevVersionId: '', html: '', sampleDataText: '{}' })

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
</script>

<template>
  <div>
    <el-button size="small" @click="openTpl()">新增模板</el-button>
    <el-button type="primary" size="small" @click="openTplv()">新建版本</el-button>

    <el-table :data="templates" size="small" highlight-current-row style="margin-top: 8px" @row-click="selectTemplate">
      <el-table-column type="index" label="#" width="50" align="center" />
      <el-table-column prop="name" label="模板" min-width="160" />
      <el-table-column label="品牌" min-width="120">
        <template #default="{ row }">{{ brands.find((b) => b._id === row.brandId)?.name ?? row.brandId }}</template>
      </el-table-column>
      <el-table-column label="创建时间" width="160">
        <template #default="{ row }"><TimeText :value="row.createdAt" /></template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button size="small" text @click="openTpl(row)">编辑</el-button>
          <el-button size="small" text type="danger" @click="confirmRemove('删除模板', String(row.name), async () => { await api('tpl:remove', { _id: row._id }); await loadTemplates() })">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div v-if="currentTpl" class="panel" style="margin-top: 8px">
      <div class="panel-title">「{{ currentTpl.name }}」版本（不可变，保存即新版本）</div>
      <el-table :data="tplVersions" size="small">
        <el-table-column type="index" label="#" width="50" align="center" />
        <el-table-column prop="label" label="版本" width="80" />
        <el-table-column label="创建时间" width="160">
          <template #default="{ row }"><TimeText :value="row.createdAt" /></template>
        </el-table-column>
        <el-table-column label="操作">
          <template #default="{ row }">
            <el-button size="small" text @click="openTplv(row)">基于此版本修改</el-button>
          </template>
        </el-table-column>
      </el-table>
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
.panel { border: 1px solid rgba(128, 128, 128, 0.25); border-radius: 6px; padding: 10px; }
.panel-title { font-size: 12px; opacity: 0.7; margin-bottom: 8px; }
</style>
