<script setup lang="ts">
/** 空列表提示 + 主行动按钮（数据契约 §6） */
defineProps<{
  description?: string
  actionText?: string
}>()

defineEmits<{ action: [] }>()
</script>

<template>
  <div class="empty-state">
    <p>{{ description ?? '暂无数据' }}</p>
    <el-button v-if="actionText" type="primary" size="small" @click="$emit('action')">
      {{ actionText }}
    </el-button>
  </div>
</template>

<style scoped>
.empty-state {
  height: 100%;
  min-height: 160px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  justify-content: center;
  opacity: 0.75;
}
.empty-state p {
  margin: 0;
}
</style>
