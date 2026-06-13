export const createImperativeRowClassSync = (rowRefs: Map<string, HTMLElement>) => {
  let activeKey: string | null = null;
  let focusedKey: string | null = null;
  let pinnedKey: string | null = null;

  // hover/focus changes are high-frequency, binding these classes through Vue
  // re-renders the whole feed, so keep the reactive state.
  // only the two affected row elements.
  const setRowClass = (
    previousKey: string | null,
    nextKey: string | null,
    className: string
  ) => {
    if (previousKey && previousKey !== nextKey) {
      rowRefs.get(previousKey)?.classList.remove(className);
    }
    if (nextKey) rowRefs.get(nextKey)?.classList.add(className);
    return nextKey;
  };

  return {
    setActive: (key: string | null) => {
      activeKey = setRowClass(activeKey, key, "active");
    },
    setFocused: (key: string | null) => {
      focusedKey = setRowClass(focusedKey, key, "focused");
    },
    setPinned: (key: string | null) => {
      pinnedKey = setRowClass(pinnedKey, key, "pinned");
    },
    sync: (active: string | null, focused: string | null, pinned: string | null) => {
      activeKey = setRowClass(activeKey, active, "active");
      focusedKey = setRowClass(focusedKey, focused, "focused");
      pinnedKey = setRowClass(pinnedKey, pinned, "pinned");
    }
  };
};
