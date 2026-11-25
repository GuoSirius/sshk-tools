<script setup lang="ts">
/**
 * 邮件编辑器（兼容壳）：2026-11-25 统一组装弹框改造后，本体迁移到 ComposeDialog.vue（scene=mail）。
 * 本文件保留原对外契约（v-model:visible + mail + saved），MailsPage 等调用方零改动；
 * 顶部两行联动下拉 / 插槽 tab / 组装预览 / 底部场景按钮全部由 ComposeDialog 承载。
 */
import ComposeDialog from './ComposeDialog.vue'
import type { MailRow } from '../tool-api'

const props = defineProps<{ visible: boolean; mail: MailRow | null }>()
const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'saved', id: string): void
}>()
</script>

<template>
  <ComposeDialog
    :visible="props.visible"
    scene="mail"
    :mail="props.mail"
    @update:visible="(v: boolean) => emit('update:visible', v)"
    @saved="(id: string) => emit('saved', id)"
  />
</template>
