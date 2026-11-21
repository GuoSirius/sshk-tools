<script setup lang="ts">
/**
 * 系统与数据 · 运行时工具包卡（P4-3 从 SystemTab 拆入）：
 * .sshktool 包预览/安装（内置冲突拦截、降级二次确认语义不变）/ 已装列表卸载 / 信任发布者公钥导入撤销。
 */
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useToolCatalog } from '../../../../composables/useToolCatalog'

type InstalledPackageRecord = import('@sshk/shared').InstalledPackageRecord
type InstallPreview = import('@sshk/shared').InstallPreview

// 工具目录单例：安装/卸载后刷新，桌面与新工具横幅立即反映（语义与原 SystemTab 一致）
const { refresh: refreshCatalog } = useToolCatalog()

// ── 运行时工具包 ──
const runtimePackages = ref<InstalledPackageRecord[]>([])
async function refreshRuntime(): Promise<void> {
  runtimePackages.value = (await window.api.runtime.list()) as InstalledPackageRecord[]
}
async function pickRuntimePackage(): Promise<void> {
  const [zip] = await window.api.os.pickFile({ filters: [{ name: '工具包', extensions: ['sshktool'] }] })
  if (!zip) return
  let preview: InstallPreview
  try { preview = (await window.api.runtime.preview(zip)) as InstallPreview }
  catch (err) { ElMessage.error(`预览失败：${(err as Error).message}`); return }
  if (preview.status === 'builtin-conflict') {
    ElMessage.error(`工具「${preview.id}」已作为内置工具随本应用分发，禁止重复安装同名外部包（如需替换请在「工具与权限」中先禁用内置版本）`)
    return
  }
  if (preview.status === 'downgrade') {
    try {
      await ElMessageBox.confirm(
        `即将从 v${preview.installedVersion} 降级到 v${preview.newVersion}。新版本可能存在问题，降级可回退；但旧版本能力 / 数据可能不兼容，确定继续？`,
        '降级安装确认', { type: 'warning', confirmButtonText: '仍要降级', cancelButtonText: '取消', closeOnClickModal: false, closeOnPressEscape: false },
      )
    } catch { return }
  }
  try {
    const { record, warnings } = (await window.api.runtime.install(zip)) as { record: InstalledPackageRecord; warnings: string[] }
    for (const w of warnings) ElMessage.warning(w)
    const tip = preview.status === 'upgrade' ? `（从 v${preview.installedVersion} 升级到 v${preview.newVersion}）` : ''
    ElMessage.success(`已安装 ${record.id}@${record.version}（${record.trustLevel} / ${record.sandbox} 沙箱）${tip}`)
    await refreshRuntime()
    await refreshCatalog()
  } catch (err) { ElMessage.error(`安装失败：${(err as Error).message}`) }
}
async function removeRuntime(id: string): Promise<void> {
  try {
    await window.api.runtime.uninstall(id)
    ElMessage.success(`已卸载 ${id}`)
    await refreshRuntime()
    await refreshCatalog()
  } catch (err) { ElMessage.error(`卸载失败：${(err as Error).message}`) }
}

// ── 信任的发布者（公钥） ──
const publicKeys = ref<{ keyId: string; label: string; importedAt: string }[]>([])
const keyImportOpen = ref(false)
const keyLabel = ref('')
const keyPem = ref('')
async function refreshKeys(): Promise<void> {
  publicKeys.value = (await window.api.runtime.keysList()) as { keyId: string; label: string; importedAt: string }[]
}
async function importKey(): Promise<void> {
  if (!keyPem.value.trim()) { ElMessage.warning('请粘贴 PEM 公钥内容'); return }
  try {
    const entry = (await window.api.runtime.keysImport(keyLabel.value, keyPem.value)) as { keyId: string; label: string }
    ElMessage.success('已导入：' + entry.label + '（' + entry.keyId + '）')
    keyImportOpen.value = false
    keyLabel.value = ''
    keyPem.value = ''
    await refreshKeys()
  } catch (err) { ElMessage.error('导入失败：' + (err as Error).message) }
}
async function revokeKey(keyId: string): Promise<void> {
  await window.api.runtime.keysRevoke(keyId)
  ElMessage.success('已撤销')
  await refreshKeys()
}

onMounted(() => {
  void refreshRuntime()
  void refreshKeys()
})
</script>

<template>
  <section class="settings-card">
    <div class="card-title">运行时工具包（.sshktool）</div>
    <div class="kv-line">
      <span>导入安装</span>
      <el-button size="small" type="primary" @click="pickRuntimePackage">选择 .sshktool 包</el-button>
    </div>
    <div v-for="pkg in runtimePackages" :key="pkg.id" class="kv-line">
      <span>{{ pkg.id }}@{{ pkg.version }}</span>
      <el-tag size="small" :type="pkg.trustLevel === 'official' ? 'success' : pkg.trustLevel === 'unsigned' ? 'danger' : 'warning'">{{ pkg.trustLevel }}</el-tag>
      <span class="hint">{{ pkg.sandbox }} · sha256:{{ pkg.sha256.slice(0, 8) }}</span>
      <el-button size="small" text type="danger" @click="removeRuntime(pkg.id)">卸载</el-button>
    </div>
    <div v-if="runtimePackages.length === 0" class="kv-line"><span class="hint">暂无运行时安装的工具包</span></div>

    <div class="card-title sub-block-title">信任的发布者（公钥）</div>
    <div class="kv-line">
      <span>导入公钥</span>
      <el-button size="small" type="primary" @click="keyImportOpen = true">粘贴 PEM</el-button>
    </div>
    <div v-for="key in publicKeys" :key="key.keyId" class="kv-line">
      <span>{{ key.label }}</span>
      <span class="hint">{{ key.keyId }} · {{ key.importedAt }}</span>
      <el-button size="small" text type="danger" @click="revokeKey(key.keyId)">撤销</el-button>
    </div>
    <div v-if="publicKeys.length === 0" class="kv-line"><span class="hint">未导入第三方公钥（官方公钥内置，无需导入）</span></div>
    <el-dialog v-model="keyImportOpen" title="导入第三方公钥" width="520px" :close-on-click-modal="false" :close-on-press-escape="false">
      <el-input clearable v-model="keyLabel" placeholder="发布者名称（如：合作方 A）" style="margin-bottom: 10px" />
      <el-input v-model="keyPem" type="textarea" :rows="8" placeholder="粘贴 PEM 公钥内容（-----BEGIN PUBLIC KEY----- ...）" />
      <template #footer>
        <el-button size="small" @click="keyImportOpen = false">取消</el-button>
        <el-button size="small" type="primary" @click="importKey">导入</el-button>
      </template>
    </el-dialog>
    <div class="hint">未签名包以 utility 沙箱安装；main 权限需要有效签名与显式信任。安装/卸载后工具目录即时刷新（useToolCatalog 单例）。</div>
  </section>
</template>

<style scoped>
/* 卡内二级标题：与 .card-title 同字号，补上块间距（原内联 style 收编为语义类） */
.sub-block-title { margin-top: var(--sshk-gap-md); }
</style>
