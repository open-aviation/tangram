<template>
  <button
    class="ui-button"
    :class="[
      `ui-button-variant-${variant}`,
      `ui-button-size-${size}`,
      {
        'ui-button-icon-only': iconOnly,
        'ui-button-muted': muted,
        'ui-button-danger': danger,
        'ui-button-active': active,
        'ui-button-align-start': align === 'start'
      }
    ]"
    type="button"
    :title="title"
    :aria-label="ariaLabel ?? title"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    ariaLabel?: string;
    muted?: boolean;
    danger?: boolean;
    disabled?: boolean;
    iconOnly?: boolean;
    active?: boolean;
    align?: "center" | "start";
    size?: "xs" | "sm" | "md";
    variant?: "ghost" | "plain" | "surface";
  }>(),
  {
    title: undefined,
    ariaLabel: undefined,
    muted: false,
    danger: false,
    disabled: false,
    iconOnly: true,
    active: false,
    align: "center",
    size: "md",
    variant: "ghost"
  }
);
</script>

<style scoped>
.ui-button {
  --ui-button-padding-x: 6px;
  --ui-button-padding-y: 6px;
  --ui-button-icon-size: 24px;
  --ui-button-min-height: 36px;
  --ui-button-radius: 6px;
  --ui-button-gap: 6px;
  background: none;
  border: 1px solid transparent;
  color: var(--t-fg);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--ui-button-gap);
  min-height: var(--ui-button-min-height);
  padding: var(--ui-button-padding-y) var(--ui-button-padding-x);
  border-radius: var(--ui-button-radius);
  line-height: 1;
  text-align: center;
  transition:
    background-color 0.2s,
    border-color 0.2s,
    color 0.2s,
    box-shadow 0.2s;
}

.ui-button:disabled {
  opacity: 0.45;
  cursor: default;
}

.ui-button-icon-only {
  min-width: calc(var(--ui-button-icon-size) + (var(--ui-button-padding-x) * 2));
}

.ui-button-align-start {
  justify-content: flex-start;
  text-align: left;
}

.ui-button-size-xs {
  --ui-button-padding-x: 2px;
  --ui-button-padding-y: 2px;
  --ui-button-icon-size: 14px;
  --ui-button-min-height: 18px;
  --ui-button-radius: 4px;
  --ui-button-gap: 4px;
}

.ui-button-size-sm {
  --ui-button-padding-x: 4px;
  --ui-button-padding-y: 4px;
  --ui-button-icon-size: 18px;
  --ui-button-min-height: 26px;
  --ui-button-radius: 5px;
  --ui-button-gap: 5px;
}

.ui-button-size-md {
  --ui-button-padding-x: 6px;
  --ui-button-padding-y: 6px;
  --ui-button-icon-size: 24px;
  --ui-button-min-height: 36px;
  --ui-button-radius: 6px;
  --ui-button-gap: 6px;
}

.ui-button-variant-plain {
  padding: 0;
}

.ui-button-variant-ghost:hover:not(:disabled),
.ui-button-variant-ghost.ui-button-active {
  background: var(--t-hover);
}

.ui-button-variant-plain.ui-button-active,
.ui-button-variant-plain:hover:not(:disabled) {
  color: var(--t-fg);
}

.ui-button-variant-surface {
  background: var(--t-bg);
  border-color: var(--t-border);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
}

.ui-button-variant-surface:hover:not(:disabled),
.ui-button-variant-surface.ui-button-active {
  background: var(--t-hover);
}

.ui-button-muted {
  color: var(--t-muted);
}

.ui-button-muted:hover:not(:disabled),
.ui-button-muted.ui-button-active {
  color: var(--t-fg);
}

.ui-button-danger:hover:not(:disabled),
.ui-button-danger.ui-button-active {
  color: var(--t-error);
}

.ui-button :deep(svg) {
  width: var(--ui-button-icon-size);
  height: var(--ui-button-icon-size);
  flex: none;
}
</style>
