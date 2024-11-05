import { defineStore } from "pinia";

export const useMapStore = defineStore("map", {
  state: () => ({
    socket: null,
    systemChannel: null, // we can't leave systemChannel int the store
    selectedPlane: null, // {}
    count: 0,
    uptime: "",
    info_utc: "",
    info_local: "local",
    showDrawer: false,
    hoverItem: null,
  }),
  getters: {
    doubleCount: ({ count }) => count * 2,
  },
  actions: {
    setInfoUtc(v) {
      this.info_utc = v;
    },
    setInfoLocal(v) {
      this.info_local = v;
    },
    setShowDrawer(v) {
      this.showDrawer = v;
    },
    setUpTime(v) {
      this.uptime = v;
    },
    setCount(v) {
      this.count = v;
    },
    setSocket(val) {
      this.socket = val;
      console.log("socket created and not available in store: ", this.socket);
    },
    setSystemChannel(val) {
      this.systemChannel = val;
    },
    pushSystemEvent(event, payload) {
      if (this.systemChannel === null) {
        console.log("systemChannel is not ready yet");
        return;
      }
      // https://hexdocs.pm/phoenix/js/#channel
      return this.systemChannel.push(event, payload); // Push
    },
    switchDrawer() {
      this.showDrawer = !this.showDrawer;
    },
    async setSelected(selected) {
      console.log("in store, select plan: ", selected);

      this.selectedPlane = selected;
      if (selected) {
        this.showDrawer = true;
      } else {
        this.showDrawer = false;
      }
      await this.pushSystemEvent("select", selected);
    },
    setHoverItem(v) {
      this.hoverItem = v;
    },
  },
});
