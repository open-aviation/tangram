import { defineStore } from 'pinia'
export const useMapStore = defineStore('map', {
  state: () => ({
    socket: null,
    selectedPlane: null,
    count: 0,
    uptime: '',
    info: '',
    showDrawer: false,
    hoverItem: null
  }),
  getters: {
    doubleCount: (state) => state.count * 2,
  },
  actions: {
    setInfo(v) {
      this.info = v
    },
    setShowDrawer( v) {
      this.showDrawer = v
    },
    setUpTime(v) {
      this.uptime = v
    },
    setCount(v) {
      this.count = v
    },
    setSocket(v) {
      this.socket = v
    },
    switchDrawer() {
      this.showDrawer = !this.showDrawer
    },
    setSelected(v) {
      this.selectedPlane = v
      if(v) {
        this.showDrawer = true
      } else {
        this.showDrawer = false
      }
    },
    setHoverItem(v) {
      this.hoverItem = v
    }
  },
})
