<template>
  <div class="color-picker">
    <input
      :value="modelValue"
      type="color"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <span class="color-value">{{ modelValue }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: string;
}>();

defineEmits(["update:modelValue"]);
</script>

<style scoped>
.color-picker {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
  min-width: 0;
}
input[type="color"] {
  background: none;
  border: none;
  height: 24px;
  width: 32px;
  padding: 0;
  cursor: pointer;
}
.color-value {
  font-size: 0.75rem;
  font-family: monospace;
  color: var(--t-muted);
}
</style>
