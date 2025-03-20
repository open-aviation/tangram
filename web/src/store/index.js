import { defineStore } from "pinia";
// import axios from 'axios'
import { Socket } from "phoenix";

// returns token { channel, id, token, url }
// this token can also be used to create a socket
async function fetchToken(name) {
  try {
    const resp = await fetch("/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: name, id: undefined }), // optinally giving an id
    });
    return await resp.json(); // { channel, id, token, url }
  } catch (e) {
    console.error("error getting channel token", e);
  }
}

// initialize socket
// returns { connectionId, socket }
async function newSocket() {
  // Specify channel here but it's not restricted.Treat it as a socket/connection token.
  const resp = await fetchToken("system");
  let { id: connectionId, token: userToken } = resp;

  let wsUrl = "";
  console.log(`${connectionId} is connecting ${wsUrl} ...`);

  const socket = new Socket(wsUrl, { debug: false, params: { userToken } });
  socket.connect();
  console.log(`socket created, connectionId: ${connectionId}`);
  return { connectionId, socket };
}

// bindings: { "update-node": this.updateNode.bind(this) }
function joinChannel(socket, channelName, bindings) {
  return new Promise((resolve, reject) => {
    console.log(`joining ${channelName} channel ...`);

    let channel = socket.channel(channelName);
    // channel.on("update-node", this.updateNode.bind(this));
    for (let [event, handler] of Object.entries(bindings)) {
      channel.on(event, handler);
    }
    channel
      .join()
      .receive("ok", ({ messages }) => {
        console.log(`(${channelName}) joined`, messages);
        this.store.setSystemChannel(channel);
        resolve(channel);
      })
      .receive("error", ({ reason }) => {
        console.log(`failed to join ${channelName}`, reason);
        reject(reason);
      })
      .receive("timeout", () => {
        console.log(`timeout joining ${channelName}`);
        reject("timeout");
      });
  });
}

export const useMapStore = defineStore("map", {
  state: () => ({
    socket: null,
    connectionId: undefined,
    systemChannel: null, // we can't leave systemChannel int the store
    selectedPlane: null, // {}
    planeData: [],
    planeTrajectory: [],

    count: 0,
    bounds: null,
    visible: 0,
    uptime: "",
    info_utc: "",
    info_local: "local",
    now_utc: null,

    showDrawer: false,
    hoverItem: null,
    altitude: [0, 40000],
    showCluster: false,
  }),
  getters: {
    trajectory: ({ selectedPlane, planeTrajectory }) => {
      let selectedIcao24 = selectedPlane ? selectedPlane.icao24 : null;
      console.log(`S/TRAJ, getting trajectory of ${selectedIcao24}, length: ${planeTrajectory.length}`);
      return selectedPlane ? planeTrajectory : [];
    },
    local_time: (store) => {
      const localDt = new Date(store.now_utc); // to local time
      return localDt.toLocaleTimeString();
    },
  },
  actions: {
    setInfoUtc({ html, now }) {
      this.info_utc = html;
      this.now_utc = now;
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
    setVisible(v) {
      this.visible = v;
    },
    setBounds(bbox) {
      this.bounds = bbox;
      const { _northEast: { lat: northEastLat, lng: northEastLng }, _southWest: { lat: southWestLat, lng: southWestLng } } = bbox;
      const payload = { connectionId: this.connectionId, northEastLat, northEastLng, southWestLat, southWestLng };
      this.pushSystemEvent("bound-box", payload);
      console.log('bound-box pushed:', payload)
    },
    setCount(v) {
      this.count = v;
    },
    setSocket(s) {
      this.socket = s;
      console.log("socket created and not available in store: ", this.socket);
    },

    setSystemChannel(ch) {
      this.systemChannel = ch;
    },
    async joinChannel(channelName, callbacks) {
      if (this.socket === null) {
        console.log("socket is not ready yet");
        return;
      }
      return joinChannel(this.socket, channelName, callbacks); // return Promise
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
    async createSocket() {
      if (this.socket) {
        console.log("socket exists, ", this.socket);
        return this.socket;
      }

      const { connectionId, socket } = await newSocket();
      this.connectionId = connectionId;
      this.socket = socket;

      // Add window beforeunload event listener for cleanup
      window.addEventListener('beforeunload', this.cleanupSocket);

      return this.socket;
    },
    cleanupSocket() {
      if (this.socket) {
        console.log(`cleaning up socket connection: ${this.connectionId}`);
        this.pushSystemEvent("leave-streaming", { connectionId: this.connectionId });
        
        // Disconnect from all channels first
        if (this.systemChannel) {
          this.systemChannel.leave();
          this.systemChannel = null;
        }
        
        // Disconnect the socket
        this.socket.disconnect();
        this.socket = null;
        this.connectionId = undefined;
        
        console.log('Socket disconnected and cleaned up');
      }
    },
    destroySocket() {
      // called when app is unmounted: App.vue
      this.cleanupSocket();
      window.removeEventListener('beforeunload', this.cleanupSocket);
    },

    async setSelected(selected) {
      // unselect => selected === null?
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
        `plane trajectory updated, icao24: ${this.selectedPlane.icao24}, length: ${this.planeTrajectory.length}`,
      );
    },
    setHoverItem(v) {
      this.hoverItem = v;
    },
  },
});
