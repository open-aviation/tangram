import { defineStore } from "pinia";
// import axios from 'axios'

export const useMapStore = defineStore("map", {
  state: () => ({
    socket: null,
    systemChannel: null, // we can't leave systemChannel int the store
    selectedPlane: null, // {}
    planeData: [],
    planeTrajectory: [],
    count: 0,
    uptime: "",
    info_utc: "",
    info_local: "local",
    showDrawer: false,
    hoverItem: null,
    altitude: [0, 40000],
    showCluster: false,
  }),
  getters: {
    doubleCount: ({ count }) => count * 2,
    trajectory: ({ selectedPlane, planeTrajectory }) => {
      console.log(`in store, getting trajectory of ${selectedPlane}, length: ${planeTrajectory.length}`);
      return selectedPlane ? planeTrajectory : [];
    },
  },
  actions: {
    setInfoUtc(v) {
      this.info_utc = v;
    },
    setCluster(v) {
      this.showCluster = v;
    },
    setAltitude(v) {
      this.altitude = v;
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
      // TODO: unselect => selected === null?
      console.log("in store, select plan: ", selected);
      this.selectedPlane = selected;
      if (selected) {
        this.showDrawer = true;
      } else {
        this.showDrawer = false;
      }
      await this.pushSystemEvent("select", selected);
    },
    setPlaneData(planeData) {
      this.planeData = planeData;
      this.planeTrajectory = planeData
        .filter(({ latitude, longitude }) => latitude !== null && longitude !== null)
        .map(({ latitude, longitude }) => [latitude, longitude]); // used by VPolyline, lat-lngs
    },
    appendPlaneTrajectory([lat, longi]) {
      this.planeTrajectory.push([lat, longi]);
      console.log(
        `plane trajectory updated, icao24: ${this.selectedPlane.icao24}, length: ${this.planeTrajectory.length}`
      );
    },
    setHoverItem(v) {
      this.hoverItem = v;
    },
  },
});
