import { fsApi } from './fsHost'
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fsFormatSize, fsModeToRwx, isFsTextName, type FsEntry } from '@sshk/shared'
import { friendlyError } from './useFsListing'

/**
 * 条目操作（P4-4 自 FileExplorerPage 拆出）：新建目录/新建文件/重命名/删除（二次确认）/编辑权限/
 * 属性/转换文本编码换行符（§十一 转换格式 A）。
 * 行为契约（与原页面逐字一致）：
 * - 删除：含目录时走 ElMessageBox.prompt 输入目录名确认（§六），纯文件走 deleteInput 弹框。
 * - 编辑权限：先读后改、确认后生效（rwx 勾选 ↔ 八进制输入双向联动，输入框是权威）。
 * - 转换格式：全通道、仅文本扩展启用；转换前 ElMessageBox.confirm 提示备份。
 * - 新建文件：创建后立即 openFile 进入编辑（页面装配时注入）。
 */
export interface FsEntryOpsDeps {
  profileId: () => string
  path: () => string
  hasMode: () => boolean
  list: (resetCursor?: boolean) => Promise<void>
  resetSelection: () => void
  selSingle: () => FsEntry | null
  selSingleFile: () => FsEntry | null
  selectOnly: (paths: string[]) => void
  openTransferPanel: () => void
  /** 新建文件成功后打开编辑器（页面装配时绑 useFsMedia.openFile） */
  openFile: (entry: FsEntry) => Promise<void>
}

export function useFsEntryOps(deps: FsEntryOpsDeps) {
  // ── 新建 / 重命名 / 删除 ──
  const mkdirOpen = ref(false)
  const mkdirName = ref('')
  const mkdirInputRef = ref<{ focus: () => void } | null>(null)
  // 打开即聚焦（页面级兜底，与全局机制双保险）
  watch(mkdirOpen, (v) => { if (v) void nextTick(() => mkdirInputRef.value?.focus()) })
  async function submitMkdir(): Promise<void> {
    const name = mkdirName.value.trim()
    if (!name || /[\\/]/.test(name)) { ElMessage.warning('目录名不能为空且不含斜杠'); return }
    try {
      await fsApi.mkdir({ profileId: deps.profileId(), path: deps.path() === '/' ? `/${name}` : `${deps.path()}/${name}` })
      mkdirOpen.value = false
      mkdirName.value = ''
      ElMessage.success('目录已创建')
      void deps.list(false)
    } catch (err) {
      ElMessage.error(friendlyError(err))
    }
  }

  const renameOpen = ref(false)
  const renameTarget = ref<FsEntry | null>(null)
  const renameName = ref('')
  const renameInputRef = ref<{ focus: () => void; select: () => void } | null>(null)
  function openRename(entry: FsEntry): void {
    renameTarget.value = entry
    renameName.value = entry.name
    renameOpen.value = true
    // 页面级兜底聚焦（用户 2026-11-19：全局机制对部分弹框时序不稳）；重命名全选便于直接输入新名
    void nextTick(() => { renameInputRef.value?.focus(); renameInputRef.value?.select() })
  }
  async function submitRename(): Promise<void> {
    const target = renameTarget.value
    const name = renameName.value.trim()
    if (!target || !name || /[\\/]/.test(name) || name === target.name) { renameOpen.value = false; return }
    const parent = target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/')) : ''
    try {
      await fsApi.mv({ profileId: deps.profileId(), sources: [{ path: target.path, kind: target.kind }], destDir: parent, renameTo: name })
      renameOpen.value = false
      void deps.list(false)
    } catch (err) {
      ElMessage.error(friendlyError(err))
    }
  }

  const deleteOpen = ref(false)
  const deleteTargets = ref<FsEntry[]>([])
  const deleteInput = ref('')
  function openDelete(list0: FsEntry[]): void {
    if (!list0.length) return
    const dirs = list0.filter((e) => e.kind === 'dir')
    deleteTargets.value = list0
    deleteInput.value = ''
    // 递归删大目录：输目录名确认（§六）
    if (dirs.length) {
      ElMessageBox.prompt(
        `将删除 ${list0.length} 项（含 ${dirs.length} 个目录及其全部内容），不可恢复。大目录会走传输队列分批删除。`,
        '删除确认',
        { confirmButtonText: '确认删除', cancelButtonText: '取消',
          inputPlaceholder: `输入 ${dirs.length === 1 ? dirs[0]!.name : 'YES'} 以确认`,
          closeOnClickModal: false, closeOnPressEscape: false, type: 'warning' },
      ).then(({ value }) => {
        const expected = dirs.length === 1 ? dirs[0]!.name : 'YES'
        if ((value ?? '').trim() !== expected) { ElMessage.warning('确认文字不匹配，已取消'); return }
        void doDelete(list0)
      }).catch(() => { /* 取消 */ })
    } else {
      deleteOpen.value = true
    }
  }
  async function confirmDelete(): Promise<void> {
    deleteOpen.value = false
    await doDelete(deleteTargets.value)
  }
  async function doDelete(list0: FsEntry[]): Promise<void> {
    if (!deps.profileId()) return
    try {
      const { taskIds } = await fsApi.rm({
        profileId: deps.profileId(),
        paths: list0.map((e) => ({ path: e.path, kind: e.kind })),
      })
      deps.resetSelection()
      if (taskIds.length) {
        deps.openTransferPanel()
        ElMessage.info(`递归删除已入队：${taskIds.length} 个目录`)
      } else {
        ElMessage.success('已删除')
      }
      void deps.list(false)
    } catch (err) {
      ElMessage.error(friendlyError(err))
    }
  }

  // ── 新建文件 ──
  async function newFile(): Promise<void> {
    try {
      const { value } = await ElMessageBox.prompt('新建空白文本文件，输入文件名（如 page.html）', '新建文件', {
        confirmButtonText: '创建并编辑', cancelButtonText: '取消',
        inputPattern: /^[^\\/:]+$/, inputErrorMessage: '文件名不能含斜杠',
        closeOnClickModal: false, closeOnPressEscape: false,
      })
      const name = String(value ?? '').trim()
      if (!name) return
      const full = deps.path() === '/' ? `/${name}` : `${deps.path()}/${name}`
      await fsApi.write({ profileId: deps.profileId(), path: full, contentBase64: '' })
      void deps.list(false)
      await deps.openFile({ kind: 'file', name, path: full })
    } catch { /* 取消 */ }
  }

  // ── §十一：编辑权限（本地 / SFTP；先读后改、确认后生效）──
  /** 编辑权限可用：单选 + 本地/SFTP 通道 + 有当前权限值（无值 = 列表没给，无从改起） */
  const canPerm = computed(() => deps.selSingle() != null && deps.hasMode() && Boolean(deps.selSingle()?.mode))
  const permOpen = ref(false)
  const permTarget = ref<FsEntry | null>(null)
  const permOctal = ref('0644')
  const permSaving = ref(false)
  function openPerm(): void {
    const t = deps.selSingle()
    if (!t || !canPerm.value) return
    permTarget.value = t
    permOctal.value = t.mode ?? '0644'
    permOpen.value = true
  }
  function permBits(): { owner: [boolean, boolean, boolean]; group: [boolean, boolean, boolean]; other: [boolean, boolean, boolean] } {
    const bits = parseInt(permOctal.value.replace(/^0?(?=[0-7]{3})/, '0'), 8) & 0o777
    const g = (shift: number): [boolean, boolean, boolean] => [Boolean((bits >> shift) & 4), Boolean((bits >> shift) & 2), Boolean((bits >> shift) & 1)]
    return { owner: g(6), group: g(3), other: g(0) }
  }
  /** rwx 勾选 ↔ 八进制输入双向联动（输入框仍是权威，勾选实时重算） */
  function togglePermBit(group: 'owner' | 'group' | 'other', idx: 0 | 1 | 2): void {
    const b = permBits()
    b[group][idx] = !b[group][idx]
    const g = (t: [boolean, boolean, boolean]): number => (t[0] ? 4 : 0) | (t[1] ? 2 : 0) | (t[2] ? 1 : 0)
    permOctal.value = '0' + g(b.owner) + g(b.group) + g(b.other)
  }
  async function submitPerm(): Promise<void> {
    const t = permTarget.value
    if (!t || !deps.profileId() || permSaving.value) return
    const octal = permOctal.value.trim()
    if (!/^0?[0-7]{3}$/.test(octal)) { ElMessage.warning('权限须为 3-4 位八进制（如 0644）'); return }
    try {
      await ElMessageBox.confirm(
        `将把「${t.name}」的权限改为 ${octal}（${fsModeToRwx(octal)}）。确认修改吗？`,
        '编辑权限',
        { confirmButtonText: '确认修改', cancelButtonText: '取消', type: 'warning', closeOnClickModal: false, closeOnPressEscape: false },
      )
    } catch { return }
    permSaving.value = true
    try {
      await fsApi.chmod({ profileId: deps.profileId(), path: t.path, modeOctal: octal })
      permOpen.value = false
      ElMessage.success('权限已修改')
      void deps.list(false)
    } catch (err) {
      ElMessage.error(friendlyError(err))
    } finally { permSaving.value = false }
  }

  // ── §十一：属性弹框（只读展示 + 编辑入口）──
  const propsOpen = ref(false)
  const propsLoading = ref(false)
  const propsEntry = ref<FsEntry | null>(null)
  const propsStat = ref<{ size?: number; modified?: number; isDir?: boolean } | null>(null)
  async function openProps(): Promise<void> {
    const t = deps.selSingle()
    if (!t) return
    await openPropsFor(t)
  }
  async function openPropsFor(entry: FsEntry): Promise<void> {
    propsEntry.value = entry
    propsStat.value = null
    propsLoading.value = true
    propsOpen.value = true
    try {
      const st = await fsApi.stat({ profileId: deps.profileId(), path: entry.path })
      propsStat.value = st.exists ? { size: st.size, modified: st.modified, isDir: st.isDir } : null
    } catch { propsStat.value = null }
    finally { propsLoading.value = false }
  }

  // ── §十一：转换格式 A（文本编码/换行符，全通道；仅文本扩展启用）──
  const convertOpen = ref(false)
  const convertTarget = ref<FsEntry | null>(null)
  const convertForm = ref<{ from: 'auto' | 'utf-8' | 'gbk' | 'big5'; to: 'utf-8' | 'gbk'; newline: 'keep' | 'lf' | 'crlf' }>({ from: 'auto', to: 'utf-8', newline: 'keep' })
  const convertSaving = ref(false)
  /** 转换可用：单选文件且为文本扩展 */
  const canConvert = computed(() => {
    const t = deps.selSingleFile()
    return t != null && isFsTextName(t.name)
  })
  function openConvert(): void {
    const t = deps.selSingleFile()
    if (!t || !canConvert.value) return
    convertTarget.value = t
    convertForm.value = { from: 'auto', to: 'utf-8', newline: 'keep' }
    convertOpen.value = true
  }
  async function submitConvert(): Promise<void> {
    const t = convertTarget.value
    if (!t || !deps.profileId() || convertSaving.value) return
    const f = convertForm.value
    const nlText = f.newline === 'keep' ? '保持换行符不变' : `换行符统一为 ${f.newline === 'lf' ? 'LF (\\n)' : 'CRLF (\\r\\n)'}`
    try {
      await ElMessageBox.confirm(
        `将读取「${t.name}」并按（${f.from === 'auto' ? '自动检测编码' : f.from} → ${f.to}，${nlText}）转换后写回原文件。转换前建议下载备份，确认执行吗？`,
        '转换文本编码 / 换行符',
        { confirmButtonText: '确认转换', cancelButtonText: '取消', type: 'warning', closeOnClickModal: false, closeOnPressEscape: false },
      )
    } catch { return }
    convertSaving.value = true
    try {
      const r = await fsApi.convertText({ profileId: deps.profileId(), path: t.path, fromEncoding: f.from, toEncoding: f.to, newline: f.newline })
      convertOpen.value = false
      if (!r.encodingChanged && !r.newlineChanged) ElMessage.info(`内容已是 ${r.detected} 编码且换行符符合要求，未做修改`)
      else ElMessage.success(`已转换：${r.detected} → ${f.to}${r.newlineChanged ? ' + 换行符' : ''}（${fsFormatSize(r.bytes)}）`)
    } catch (err) {
      ElMessage.error(friendlyError(err))
    } finally { convertSaving.value = false }
  }

  return {
    // 新建 / 重命名 / 删除 / 新建文件
    mkdirOpen, mkdirName, mkdirInputRef, submitMkdir,
    renameOpen, renameTarget, renameName, renameInputRef, openRename, submitRename,
    deleteOpen, deleteTargets, deleteInput, openDelete, confirmDelete, doDelete,
    newFile,
    // 权限
    canPerm, permOpen, permTarget, permOctal, permSaving, openPerm, permBits, togglePermBit, submitPerm,
    // 属性
    propsOpen, propsLoading, propsEntry, propsStat, openProps, openPropsFor,
    // 转换
    canConvert, convertOpen, convertTarget, convertForm, convertSaving, openConvert, submitConvert,
  }
}

export type FsEntryOpsApi = ReturnType<typeof useFsEntryOps>
