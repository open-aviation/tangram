<template>
  <svg :viewBox="viewBox" aria-hidden="true">
    <path :d="path" fill="currentColor" />
  </svg>
</template>

<script setup lang="ts">
import { MATERIAL_ICON_VIEW_BOX } from "./utils";

withDefaults(
  defineProps<{
    path: string;
    viewBox?: string;
  }>(),
  {
    viewBox: MATERIAL_ICON_VIEW_BOX
  }
);
</script>
