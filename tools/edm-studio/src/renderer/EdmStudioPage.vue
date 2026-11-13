<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { EmptyState, TimeText, ToolPageLayout } from '@sshk/ui-kit'

// api() 返回 unknown，本地做最小结构约束
interface Named { _id: string; name: string; [k: string]: unknown }
interface BrandRow extends Named { code: string }
interface VersionRow extends Named { version: number; label?: string; source?: { html: string }; templateId?: string; fragmentId?: string; slots?: { key: string; type: string }[]; policy?: { blacklist: string[]; whitelist: string[] }; sampleData?: Record<string, unknown> }
interface MailRow extends Named { templateVersionId: string; bindings?: { slot: string; fragmentVersionId: string }[]; outputs?: Record<string, string>; lastGeneratedAt?: string; data?: Record<string, unknown> }

// 左侧菜单驱动页签（需求 8：工具所有功能菜单在左侧）
const props = defineProps<{ menu?: string }>()
const tab = ref('brands')
watch(() => props.menu, (v) => { if (v) tab.value = v }, { immediate: true })
const api = (action: string, data?: Record<string, unknown>) => window.api.edm.api(action, data)

/** 统一删除确认（危险操作二次确认） */
async function confirmRemove(title: string, name: string, run: () => Promise<void>): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定删除「${name}」？记录将归档。`, title, { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch {
    return
  }
  await run()
}

// ── 品牌（D29 独立管理） ──
const brands = ref<BrandRow[]>([])
const brandOpen = ref(false)
const brandForm = ref<{ _id: string; code: string; name: string }>({ _id: '', code: '', name: '' })

async function loadBrands(): Promise<void> {
  brands.value = (await api('brand:list')) as BrandRow[]
}
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

// ── 模板 ──
const templates = ref<Named[]>([])
const tplOpen = ref(false)
const tplForm = ref<{ _id: string; brandId: string; name: string; description: string }>({ _id: '', brandId: '', name: '', description: '' })
const tplVersions = ref<VersionRow[]>([])
const currentTpl = ref<Named | null>(null)
const tplvOpen = ref(false)
const tplvForm = ref<{ templateId: string; prevVersionId: string; html: string; sampleDataText: string }>({ templateId: '', prevVersionId: '', html: '', sampleDataText: '{}' })

async function loadTemplates(): Promise<void> {
  templates.value = (await api('tpl:list')) as Named[]
}
async function selectTemplate(row: Named): Promise<void> {
  currentTpl.value = row
  // 模板版本列表：全部版本中筛本族（简化：按 createdAt 倒序后前端过滤）
  const all = (await api('tpl:list')) as Named[]
  void all
  tplVersions.value = ((await api('tplv:get', { _id: row.latestVersionId ?? '' })) ? [await api('tplv:get', { _id: row.latestVersionId })] : []) as VersionRow[]
}
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

// ── 片段 ──
const fragments = ref<Named[]>([])
const frgOpen = ref(false)
const frgForm = ref<{ _id: string; brandId: string; name: string; type: string }>({ _id: '', brandId: '', name: '', type: 'product' })
const currentFrg = ref<Named | null>(null)
const frgvOpen = ref(false)
const frgvForm = ref<{ fragmentId: string; prevVersionId: string; html: string; blacklistText: string; whitelistText: string }>({ fragmentId: '', prevVersionId: '', html: '', blacklistText: '', whitelistText: '' })

async function loadFragments(): Promise<void> {
  fragments.value = (await api('frg:list')) as Named[]
}
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
  currentFrg.value = row ?? currentFrg.value
  if (!currentFrg.value) {
    ElMessage.warning('先选择片段族')
    return
  }
  frgvForm.value = {
    fragmentId: currentFrg.value._id,
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

// ── 邮件 ──
const mails = ref<MailRow[]>([])
const mailOpen = ref(false)
const mailForm = ref<{ _id: string; name: string; templateVersionId: string; bindingsText: string; dataText: string }>({ _id: '', name: '', templateVersionId: '', bindingsText: '', dataText: '{}' })
const mailGenerating = ref('')

const tplvOptions = computed(() => tplVersions.value.map((v) => ({ label: `${v.label ?? `v${v.version}`}`, value: v._id })))

async function loadMails(): Promise<void> {
  mails.value = (await api('mail:list')) as MailRow[]
}
function openMail(row?: MailRow): void {
  mailForm.value = row
    ? {
        _id: row._id,
        name: String(row.name ?? ''),
        templateVersionId: row.templateVersionId,
        bindingsText: JSON.stringify(row.bindings ?? []),
        dataText: JSON.stringify(row.data ?? {}, null, 2),
      }
    : { _id: '', name: '', templateVersionId: tplVersions.value[0]?._id ?? '', bindingsText: '[{"slot":"header","fragmentVersionId":""}]', dataText: '{}' }
  mailOpen.value = true
}
async function saveMail(): Promise<void> {
  try {
    await api('mail:save', {
      ...mailForm.value,
      bindings: JSON.parse(mailForm.value.bindingsText),
      data: JSON.parse(mailForm.value.dataText),
    })
    mailOpen.value = false
    await loadMails()
    ElMessage.success('邮件已保存')
  } catch (err) { ElMessage.error((err as Error).message) }
}
async function generateMail(row: MailRow): Promise<void> {
  mailGenerating.value = row._id
  try {
    await api('mail:generate', { _id: row._id })
    await loadMails()
    ElMessage.success('三阶段产物已生成（覆盖式）')
  } catch (err) { ElMessage.error((err as Error).message) }
  finally { mailGenerating.value = '' }
}
async function copyFinal(row: MailRow): Promise<void> {
  try {
    const html = (await api('mail:readFinal', { _id: row._id })) as string
    await window.api.os.clipboardWrite(html)
    ElMessage.success('final.html 已复制')
  } catch (err) { ElMessage.error((err as Error).message) }
}
async function openOutput(row: MailRow): Promise<void> {
  if (row.outputs?.final) await window.api.os.shellOpen(`outputs/edm/${row._id}/final.html`)
}
async function shareStart(): Promise<void> {
  try {
    const res = (await api('share:start', { ttlHours: 72 })) as { urls: string[] }
    await window.api.os.clipboardWrite(res.urls[0] ?? '')
    ElMessage.success(`分享已启动：${res.urls[0]}（已复制，72h 有效）`)
  } catch (err) { ElMessage.error((err as Error).message) }
}

onMounted(async () => {
  await loadBrands()
  await loadTemplates()
  await loadFragments()
  await loadMails()
})
</script>

<template>
  <ToolPageLayout title="EDM Studio" description="品牌 → 模板/片段（版本不可变）→ 邮件三阶段产物 → 导出与分享">
    <template #actions>
      <el-button v-if="tab === 'brands'" type="primary" size="small" @click="openBrand()">新增品牌</el-button>
      <template v-if="tab === 'templates'">
        <el-button size="small" @click="openTpl()">新增模板</el-button>
        <el-button type="primary" size="small" @click="openTplv()">新建版本</el-button>
      </template>
      <template v-if="tab === 'fragments'">
        <el-button size="small" @click="openFrg()">新增片段</el-button>
        <el-button type="primary" size="small" @click="openFrgv()">新建片段版本</el-button>
      </template>
      <el-button v-if="tab === 'mails'" size="small" @click="openMail()">新增邮件</el-button>
      <el-button v-if="tab === 'mails'" type="success" size="small" @click="shareStart">启动分享</el-button>
    </template>

    <!-- 品牌 -->
    <template v-if="tab === 'brands'">
      <el-table v-if="brands.length > 0" :data="brands" size="small">
        <el-table-column prop="code" label="code" width="140" />
        <el-table-column prop="name" label="名称" min-width="160" />
        <el-table-column label="创建时间" width="160">
          <template #default="{ row }"><TimeText :value="row.createdAt" /></template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text @click="openBrand(row)">编辑</el-button>
            <el-button size="small" text type="danger" @click="confirmRemove('删除品牌', row.name, async () => { await api('brand:remove', { _id: row._id }); await loadBrands() })">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState v-else description="还没有品牌；品牌是模板与片段的归属单位" action-text="新增品牌" @action="openBrand()" />
    </template>

    <!-- 模板 -->
    <template v-else-if="tab === 'templates'">
      <el-table :data="templates" size="small" highlight-current-row @row-click="selectTemplate">
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
    </template>

    <!-- 片段 -->
    <template v-else-if="tab === 'fragments'">
      <el-table :data="fragments" size="small">
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
    </template>

    <!-- 邮件 -->
    <template v-else>
      <el-table :data="mails" size="small">
        <el-table-column type="index" label="#" width="50" align="center" />
        <el-table-column prop="name" label="邮件" min-width="150" />
        <el-table-column label="生成时间" width="160">
          <template #default="{ row }"><TimeText :value="row.lastGeneratedAt" placeholder="未生成" /></template>
        </el-table-column>
        <el-table-column label="产物" min-width="200">
          <template #default="{ row }"><span class="muted">{{ row.outputs?.final ?? '—' }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text @click="openMail(row)">编辑</el-button>
            <el-button size="small" text type="primary" :loading="mailGenerating === row._id" @click="generateMail(row)">生成</el-button>
            <el-button size="small" text @click="copyFinal(row)">复制代码</el-button>
            <el-button size="small" text @click="openOutput(row)">打开产物</el-button>
            <el-button size="small" text type="danger" @click="confirmRemove('删除邮件', row.name, async () => { await api('mail:remove', { _id: row._id }); await loadMails() })">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="panel" style="margin-top: 8px">
        <div class="panel-title">导出 / 分享</div>
        <el-button size="small" @click="shareStart">启动局域网分享（72h token）</el-button>
        <span class="muted" style="margin-left: 8px">分享 final.html；打开数据目录可直接取 outputs/edm/&lt;mailId&gt;/ 下三阶段文件</span>
      </div>
    </template>

    <template #footer>
      <span class="muted">版本不可变（D8）· 覆盖式产物（D19）· 黑名单优先（D14）· 北京时间（D22）</span>
    </template>

    <!-- 弹窗组 -->
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

    <el-dialog :close-on-click-modal="false" :close-on-press-escape="false" v-model="mailOpen" :title="mailForm._id ? '编辑邮件' : '新增邮件'" width="640px">
      <el-form label-width="80px" size="small">
        <el-form-item label="名称"><el-input v-model="mailForm.name" /></el-form-item>
        <el-form-item label="模板版本">
          <el-select v-model="mailForm.templateVersionId" style="width: 100%">
            <el-option v-for="v in tplvOptions" :key="v.value" :label="v.label" :value="v.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="绑定"><el-input v-model="mailForm.bindingsText" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="数据"><el-input v-model="mailForm.dataText" type="textarea" :rows="6" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="mailOpen = false">取消</el-button>
        <el-button size="small" type="primary" @click="saveMail">保存</el-button>
      </template>
    </el-dialog>
  </ToolPageLayout>
</template>

<style scoped>
.panel {
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 6px;
  padding: 10px;
}
.panel-title {
  font-size: 12px;
  opacity: 0.7;
  margin-bottom: 8px;
}
.muted {
  opacity: 0.6;
  font-size: 12px;
}
</style>
