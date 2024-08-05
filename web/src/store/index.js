import { createStore } from "vuex";

export default createStore({
  state: {
    socket: null,
    selectedPlane: null,
    count: 0,
    uptime: '',
    info: '',
    showDrawer: false,
  },
  mutations: {
    setInfo(state, v) {
      state.info = v
    },
    setShowDrawer(state, v) {
      state.showDrawer = v
    },
    setUpTime(state, v) {
      state.uptime = v
    },
    setCount(state, v) {
      state.count = v
    },
    setSocket(state, v) {
      state.socket = v
    },
    switchDrawer(state) {
      state.showDrawer = !state.showDrawer
    },
    setSelected(state, v) {
      state.selectedPlane = v
      if(v) {
        state.showDrawer = true
      } else {
        state.showDrawer = false
      }
    }
  }
})
