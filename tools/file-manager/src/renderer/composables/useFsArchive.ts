import { fsApi } from './fsHost'
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fsFormatSize, isFsZipName, type FsChannelInfo, type FsEntry } from '@sshk/shared'
import { friendlyError } from './useFsListing'
import type { FsDirPickerApi } from './useFsDirPicker'

/**
 * 压缩 / 解压（§十一 仅本地通道 + fflate，P4-4 自 FileExplorerPage 拆出）。
 * 行为契约（与原页面逐字一致）：
 * - 压缩：ElMessageBox.prompt 输入 zip 名（.zip 结尾、不含斜杠），落当前目录。
 * - 解压到…（用户 2026-11-19 定版）：目标通道可选（跨源解压）+ 目录手输/级联
 *   （不存在自动创建）+ 目标已有同名条目时覆盖确认。zip 从源通道读入内存后写入目标通道。
 * - 压缩/解压上限（app.fs.zipFileCap / zipBytesCap）：main 侧钳制合法区间，页内弹框读写。
 */
export interface FsArchiveDeps {
  profileId: () => string
  path: () => string
  hasWritable: () => boolean
  activeChannel: () => FsChannelInfo | null
  selectedEntries: () => FsEntry[]
  selSingleFile: () => FsEntry | null
  list: (resetCursor?: boolean) => Promise<void>
  dirPicker: FsDirPickerApi
}

export function useFsArchive(deps: FsArchiveDeps) {
  // ── §十一：压缩/解压上限设置（持久到 app 配置，main 侧钳制合法区间）──
  const zipLimitsOpen = ref(false)
  const zipLimitsForm = ref({ fileCap: 3000, bytesCapMb: 500 })
  const zipLimitsSaving = ref(false)
  async function openZipLimits(): Promise<void> {
    try {
      const cur = await fsApi.zipLimits()
      zipLimitsForm.value = { fileCap: cur.fileCap, bytesCapMb: cur.bytesCapMb }
    } catch { /* 读取失败按缺省值打开 */ }
    zipLimitsOpen.value = true
  }
  async function submitZipLimits(): Promise<void> {
    zipLimitsSaving.value = true
    try {
      const r = await fsApi.setZipLimits({ fileCap: zipLimitsForm.value.fileCap, bytesCapMb: zipLimitsForm.value.bytesCapMb })
      zipLimitsForm.value = { fileCap: r.fileCap, bytesCapMb: r.bytesCapMb }
      ElMessage.success('压缩上限已更新')
      zipLimitsOpen.value = false
    } catch (err) {
      ElMessage.error(friendlyError(err))
    } finally {
      zipLimitsSaving.value = false
    }
  }

  const zipSaving = ref(false)
  async function doZip(targets?: FsEntry[]): Promise<void> {
    if (!deps.hasWritable() || deps.activeChannel()?.type !== 'local') { ElMessage.warning('压缩仅支持可写的本地目录通道'); return }
    const list0 = targets ?? deps.selectedEntries()
    if (!list0.length) return
    const first = list0[0]!
    const defaultName = list0.length === 1 ? `${first.name}.zip` : `选中${list0.length}项.zip`
    try {
      const { value } = await ElMessageBox.prompt('在当前目录创建 zip 压缩包，输入文件名', '压缩', {
        confirmButtonText: '压缩', cancelButtonText: '取消',
        inputValue: defaultName,
        inputPattern: /^[^\\/:]+\.zip$/i, inputErrorMessage: '文件名不能含斜杠且须以 .zip 结尾',
        closeOnClickModal: false, closeOnPressEscape: false,
      })
      const name = String(value ?? '').trim()
      if (!name) return
      zipSaving.value = true
      const zipPath = deps.path() === '/' ? `/${name}` : `${deps.path()}/${name}`
      const r = await fsApi.zip({
        profileId: deps.profileId(),
        zipPath,
        sources: list0.map((e) => ({ path: e.path, kind: e.kind })),
      })
      ElMessage.success(`已压缩 ${r.files} 个文件 → ${name}（${fsFormatSize(r.size)}）`)
      void deps.list(false)
    } catch (err) {
      if ((err as Error).message !== 'cancel' && err !== 'cancel') ElMessage.error(friendlyError(err))
    } finally { zipSaving.value = false }
  }

  /** 压缩/解压可用性（§十一 动态启用） */
  const canZip = computed(() => deps.hasWritable() && deps.activeChannel()?.type === 'local' && deps.selectedEntries().length > 0)
  const canUnzip = computed(() => {
    const f = deps.selSingleFile()
    return deps.hasWritable() && f != null && isFsZipName(f.name)
  })

  // ── 解压到…（用户 2026-11-19 定版）：目标通道可选（跨源解压）+ 目录手输/级联
  //    （不存在自动创建）+ 目标已有同名条目时覆盖确认。zip 从源通道读入内存后写入目标通道。 ──
  const unzipOpen = ref(false)
  const unzipSaving = ref(false)
  const unzipEntry = ref<FsEntry | null>(null)
  const unzipDestProfile = ref('')
  const unzipDirInput = ref('')
  const unzipCascaderRef = ref<{ togglePopperVisible: (v: boolean) => void } | null>(null)
  const unzipCascaderPicked = ref('') // 级联自身选中值，仅 @change 驱动（同 move，不绑手输框）
  watch(unzipDestProfile, () => { unzipCascaderPicked.value = '' })
  const unzipDirProps = deps.dirPicker.dirLazyProps(() => unzipDestProfile.value)

  function openUnzip(entry: FsEntry): void {
    if (!deps.hasWritable()) { ElMessage.warning('当前没有可写的目标通道，无法解压'); return }
    if (!isFsZipName(entry.name)) { ElMessage.warning('仅支持 .zip 压缩包'); return }
    unzipEntry.value = entry
    unzipDestProfile.value = deps.profileId()
    const base = entry.name.replace(/\.zip$/i, '')
    const parent = entry.path.lastIndexOf('/') <= 0 ? '/' : entry.path.slice(0, entry.path.lastIndexOf('/'))
    unzipDirInput.value = parent === '/' ? `/${base}` : `${parent}/${base}`
    // 输入框默认 = zip 所在目录下以 zip 名新建（根目录不可解压，属「打开时已指定」特例）；cascader 不预选，避免与输入框显示不一致
    unzipCascaderPicked.value = ''
    unzipOpen.value = true
  }
  function onUnzipDirPicked(v: unknown): void {
    unzipDirInput.value = String(v ?? '')
    unzipCascaderPicked.value = String(v ?? '')
    unzipCascaderRef.value?.togglePopperVisible(false)
  }
  async function submitUnzip(overwrite = false): Promise<void> {
    const entry = unzipEntry.value
    if (!entry || unzipSaving.value) return
    const destDir = deps.dirPicker.normalizeDestInput(unzipDirInput.value)
    if (destDir === null) { ElMessage.warning('目录路径非法（不能含 . / .. 段）'); return }
    if (!destDir || destDir === '/') { ElMessage.warning('目标目录不能为根目录，请填写具体目录（不存在会自动创建）'); return }
    unzipSaving.value = true
    try {
      const r = await fsApi.unzip({ profileId: deps.profileId(), path: entry.path, destProfileId: unzipDestProfile.value, destDir, overwrite })
      unzipOpen.value = false
      ElMessage.success(`已解压 ${r.files} 个文件 → ${unzipDestProfile.value === deps.profileId() ? r.destDir : `${unzipDestProfile.value}:${r.destDir}`}`)
      if (unzipDestProfile.value === deps.profileId()) void deps.list(false)
    } catch (err) {
      const msg = (err as Error).message ?? ''
      if (msg.startsWith('__UNZIP_CONFLICT__:')) {
        // 目标目录已有同名条目：覆盖确认（用户拍板三选收敛为 覆盖/取消，改目录回弹框改）
        try {
          await ElMessageBox.confirm(`目标目录已存在同名条目：${msg.slice('__UNZIP_CONFLICT__:'.length)}。覆盖解压（同名文件将被覆盖）？`, '目标已有同名条目', {
            type: 'warning', confirmButtonText: '覆盖解压', cancelButtonText: '取消',
            closeOnClickModal: false, closeOnPressEscape: false,
          })
          // 递归重试前放行保存守卫（本次调用尚未走出 catch，finally 尚未复位）
          unzipSaving.value = false
          await submitUnzip(true)
        } catch { /* 取消：留在弹框可改目录 */ }
      } else {
        ElMessage.error(friendlyError(err))
      }
    } finally { unzipSaving.value = false }
  }

  return {
    // 压缩/解压上限
    zipLimitsOpen, zipLimitsForm, zipLimitsSaving, openZipLimits, submitZipLimits,
    // 压缩 / 解压
    zipSaving, doZip, canZip, canUnzip,
    unzipOpen, unzipSaving, unzipEntry, unzipDestProfile, unzipDirInput, unzipCascaderRef, unzipCascaderPicked,
    unzipDirProps, openUnzip, onUnzipDirPicked, submitUnzip,
  }
}

export type FsArchiveApi = ReturnType<typeof useFsArchive>
