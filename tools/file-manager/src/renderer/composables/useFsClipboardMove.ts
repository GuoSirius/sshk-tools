import { fsApi } from './fsHost'
import { ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FsChannelInfo, FsEntry } from '@sshk/shared'
import { friendlyError } from './useFsListing'
import type { FsDirPickerApi } from './useFsDirPicker'

/**
 * 剪贴板与复制/移动弹框（P4-4 自 FileExplorerPage 拆出）：复制（剪贴板）/剪切/粘贴/复制到/移动到。
 * 行为契约（与原页面逐字一致）：
 * - 顶部粘贴与弹框/行级同流程：单源且「同源同目录」（复制后原地粘贴，mv/cp 会因 dest===src 报错）
 *   或粘进自身子目录时，弹重命名循环；多源保持主进程逐项校验。重命名取消=整个粘贴终止，剪贴板保留。
 * - 跨通道粘贴（二期）：复制语义走 crossCopy；剪切跨通道降级为复制（源保留，避免半删风险）。
 * - 目标通道可跨通道互拷（项20）；move 模式不支持跨通道；粘贴完成后询问是否清空剪贴板（2026-11-18）。
 */
export interface FsClipboardMoveDeps {
  profileId: () => string
  path: () => string
  hasWritable: () => boolean
  selectedEntries: () => FsEntry[]
  /** 操作完成后清空选中（提交移动/删除等原行为 selection.value = new Set()） */
  resetSelection: () => void
  /** 行内「复制/移动」先单选该条目再开弹框（原行为 selection.value = new Set([entry.path])） */
  selectOnly: (paths: string[]) => void
  list: (resetCursor?: boolean) => Promise<void>
  channels: () => FsChannelInfo[]
  openTransferPanel: () => void
  dirPicker: FsDirPickerApi
}

interface Clipboard { op: 'copy' | 'cut'; profileId: string; items: { path: string; kind: 'dir' | 'file' }[] }

export function useFsClipboardMove(deps: FsClipboardMoveDeps) {
  const clipboard = ref<Clipboard | null>(null)

  function clipCopy(op: 'copy' | 'cut'): void {
    if (!deps.selectedEntries().length) return
    clipboard.value = { op, profileId: deps.profileId(), items: deps.selectedEntries().map((e) => ({ path: e.path, kind: e.kind })) }
    ElMessage.success(op === 'copy' ? `已复制 ${clipboard.value.items.length} 项` : `已剪切 ${clipboard.value.items.length} 项`)
  }

  /** 上次成功选定/提交的目标目录（项18）：EP cascader 关闭弹框不清内部显示，手输框必须同步回显同一个值 */
  const lastMoveDir = ref('')
  const moveOpen = ref(false)
  const moveMode = ref<'copy' | 'move'>('copy')
  const moveDirInput = ref('')
  /** 复制目标通道（跨通道互拷二期；move 模式不支持跨通道） */
  const moveDestProfile = ref('')
  const moveDirProps = deps.dirPicker.dirLazyProps(() => moveDestProfile.value || deps.profileId())
  const moveCascaderRef = ref<{ togglePopperVisible: (visible: boolean) => void } | null>(null)
  /** 级联自身选中值（仅 @change 驱动）：用于「只选根」回显 / 的 class 判断。
   *  不能绑手输框值——用户手输改 / 时不该影响级联框的显示（用户 2026-11-19） */
  const moveCascaderPicked = ref('')
  // 通道切换 → 级联 :key 重建、内部选中态清空，镜像 ref 同步清空（不碰 lastMoveDir，手输回填不受影响）
  watch(moveDestProfile, () => { moveCascaderPicked.value = '' })
  /** 点单选圈：路径回填手输框并收起面板（checkStrictly 下 EP 不会自动收起） */
  function onMoveDirPicked(v: unknown): void {
    moveDirInput.value = String(v ?? '')
    moveCascaderPicked.value = String(v ?? '')
    if (moveDirInput.value) lastMoveDir.value = moveDirInput.value
    moveCascaderRef.value?.togglePopperVisible(false)
  }

  function openMove(mode: 'copy' | 'move'): void {
    if (!deps.selectedEntries().length) return
    moveMode.value = mode
    // 默认回填根目录「/」（用户 2026-11-19：除打开时指定/非首次复用上传位置）；非首次才用 lastMoveDir
    moveDirInput.value = lastMoveDir.value || '/'
    moveDestProfile.value = deps.profileId()
    // cascader 仅在输入框为根目录时回显「/」，其余保持未选，避免与输入框显示不一致
    moveCascaderPicked.value = moveDirInput.value === '/' ? '/' : ''
    moveOpen.value = true
  }
  /** 行内直达（§3.2 行操作列）：单选该条目后走「复制到/移动到」弹框 */
  function rowCopy(entry: FsEntry): void {
    deps.selectOnly([entry.path])
    openMove('copy')
  }
  function rowMove(entry: FsEntry): void {
    deps.selectOnly([entry.path])
    openMove('move')
  }

  async function submitMove(): Promise<void> {
    const dest = deps.dirPicker.normalizeDestInput(moveDirInput.value)
    if (dest === null) { ElMessage.warning('目标目录不合法（不允许 . / .. 或反斜杠）'); return }
    const sources = deps.selectedEntries().map((e) => ({ path: e.path, kind: e.kind }))
    const cross = Boolean(moveDestProfile.value && moveDestProfile.value !== deps.profileId())

    // 同源同目录复制/移动：目标与源同名会覆盖自身 → 弹重命名框循环直到不重名或取消
    let renameTo = ''
    if (!cross && sources.length === 1) {
      const src = sources[0]!
      const srcParent = src.path.lastIndexOf('/') <= 0 ? '/' : src.path.slice(0, src.path.lastIndexOf('/'))
      if (srcParent === dest) {
        const destPath = dest === '/' ? src.path : `${dest}${src.path.slice(srcParent.length)}`
        if (await deps.dirPicker.destExists(destPath)) {
          const renamed = await deps.dirPicker.askRenameForConflict(deps.selectedEntries()[0]!, dest)
          if (renamed === null) return // 用户取消：操作终止，保持弹框打开
          renameTo = renamed
        }
      }
    }

    moveOpen.value = false
    try {
      if (cross) {
        // 跨通道（项20）：复制/移动都走 crossCopy，move=true 时目标写成功即删源
        const r = await fsApi.crossCopy({
          srcProfileId: deps.profileId(), destProfileId: moveDestProfile.value,
          sources, destDir: dest, move: moveMode.value === 'move',
        })
        deps.openTransferPanel()
        ElMessage.info(`跨通道${moveMode.value === 'move' ? '移动' : '复制'}已入队：${r.files} 个文件${r.truncated ? '（目录超过 1500 个文件，已截断）' : ''}`)
      } else if (moveMode.value === 'move') {
        await fsApi.mv({ profileId: deps.profileId(), sources, destDir: dest, renameTo: renameTo || undefined })
        ElMessage.success('已移动')
      } else {
        const { taskIds } = await fsApi.cp({ profileId: deps.profileId(), sources, destDir: dest, renameTo: renameTo || undefined })
        if (taskIds.length) { deps.openTransferPanel(); ElMessage.info(`复制任务已入队：${taskIds.length} 个`) }
        else ElMessage.success(renameTo ? `已复制为 ${renameTo}` : '已复制')
      }
      deps.resetSelection()
      void deps.list(false)
    } catch (err) {
      ElMessage.error(friendlyError(err))
    }
  }

  async function paste(): Promise<void> {
    await pasteInto(deps.path())
  }

  /** §十一 行级粘贴：目录行的「粘贴」落点为该目录（复制/剪切语义与顶部粘贴一致） */
  async function rowPaste(entry: FsEntry): Promise<void> {
    await pasteInto(entry.path)
  }
  /** 粘贴完成后询问是否清空剪贴板（用户 2026-11-18：避免用户不知是否完成而重复粘贴；保留=可能还要粘到别处） */
  async function askClipboardAfterPaste(): Promise<void> {
    try {
      await ElMessageBox.confirm('粘贴指令已完成。是否清空剪贴板？', '粘贴完成', {
        type: 'info', showClose: false, closeOnClickModal: false, closeOnPressEscape: false,
        confirmButtonText: '清空剪贴板', cancelButtonText: '保留（还要粘到别处）',
      })
      clipboard.value = null
      ElMessage.success('剪贴板已清空')
    } catch { /* 保留剪贴板 */ }
  }

  async function pasteInto(destDir: string): Promise<void> {
    const clip = clipboard.value
    if (!clip || !deps.profileId() || !deps.hasWritable()) return
    // 跨通道粘贴（二期）：复制语义走 crossCopy；剪切跨通道降级为复制（源保留，避免半删风险）
    if (clip.profileId !== deps.profileId()) {
      if (!deps.hasWritable()) { ElMessage.warning('当前通道不支持写操作，无法作为粘贴目标'); return }
      try {
        const r = await fsApi.crossCopy({ srcProfileId: clip.profileId, destProfileId: deps.profileId(), sources: clip.items, destDir })
        if (clip.op === 'cut') ElMessage.info('跨通道剪切按复制执行（源文件保留）')
        deps.openTransferPanel()
        ElMessage.info(`跨通道复制已入队：${r.files} 个文件${r.truncated ? '（目录超过 1500 个文件，已截断）' : ''}`)
        void deps.list(false)
        await askClipboardAfterPaste()
      } catch (err) {
        ElMessage.error(friendlyError(err))
      }
      return
    }
    try {
      // 用户 2026-11-19：顶部粘贴与弹框/行级同流程——单源且「同源同目录」（复制后原地粘贴，
      // mv/cp 会因 dest===src 报错）或粘进自身子目录时，弹重命名循环；无冲突保持原行为。
      // 多源保持原行为（主进程逐项校验）。重命名取消=整个粘贴终止，剪贴板保留。
      let renameTo: string | undefined
      if (clip.items.length === 1) {
        const src = clip.items[0]!.path
        const name = src.split('/').pop() || src
        const srcParent = src.lastIndexOf('/') <= 0 ? '/' : src.slice(0, src.lastIndexOf('/'))
        const dest = destDir === '/' ? `/${name}` : `${destDir}/${name}`
        if (srcParent === destDir || dest.startsWith(`${src}/`)) {
          const renamed = await deps.dirPicker.askRenameForConflict({ name } as FsEntry, destDir)
          if (renamed === null) return // 用户取消：终止粘贴，剪贴板保留
          renameTo = renamed
        }
      }
      if (clip.op === 'cut') {
        await fsApi.mv({ profileId: deps.profileId(), sources: clip.items, destDir, renameTo })
        clipboard.value = null
        ElMessage.success('已粘贴（移动）')
      } else {
        const { taskIds } = await fsApi.cp({ profileId: deps.profileId(), sources: clip.items, destDir, renameTo })
        if (taskIds.length) { deps.openTransferPanel(); ElMessage.info(`复制任务已入队：${taskIds.length} 个`) }
        else ElMessage.success(renameTo ? `已粘贴为 ${renameTo}` : '已粘贴（复制）')
        await askClipboardAfterPaste()
      }
      void deps.list(false)
    } catch (err) {
      ElMessage.error(friendlyError(err))
    }
  }

  /** 用户 2026-11-19：清空剪贴板（误触复制后取消，不必粘贴）；「清空」属主动放弃操作，二次确认 */
  async function clearClipboard(): Promise<void> {
    const n = clipboard.value?.items.length ?? 0
    try {
      await ElMessageBox.confirm(`清空剪贴板中的 ${n} 项？清空后需重新复制才能粘贴。`, '清空剪贴板', {
        type: 'warning', showClose: false, closeOnClickModal: false, closeOnPressEscape: false,
        confirmButtonText: '清空', cancelButtonText: '保留',
      })
    } catch { return }
    clipboard.value = null
    ElMessage.success('剪贴板已清空')
  }

  return {
    clipboard,
    clipCopy, clearClipboard, paste, rowPaste,
    moveOpen, moveMode, moveDirInput, moveDestProfile, moveDirProps, moveCascaderRef, moveCascaderPicked,
    openMove, onMoveDirPicked, submitMove, rowCopy, rowMove,
  }
}

export type FsClipboardMoveApi = ReturnType<typeof useFsClipboardMove>
