<template>
  <l-polyline ref="polylineRef" :lat-lngs="polyline" :color="color"> </l-polyline>
</template>

<script>
import "leaflet/dist/leaflet.css";
import { LPolyline } from "@vue-leaflet/vue-leaflet";
import { useMapStore } from "../store";

export default {
  components: {
    LPolyline,
  },
  data() {
    return {
      staticAnchor: [16, 37],
      color: "purple",
      store: useMapStore(),
      trajectoryChannel: null,
    };
  },
  computed: {
    selected() {
      return this.store.selectedPlane;
    },
    polyline() {
      const line = this.store.trajectory;
      console.log(`getting polyline, length: ${line.length}`);
      return line;
    }
  },
  watch: {
    selected: async function (newVal, oldVal) {
      let newIcao24 = newVal ? newVal.icao24 : null;
      let oldIcao24 = oldVal ? oldVal.icao24 : null;
      console.log(`plane changes, ${oldIcao24} -> ${newIcao24}`);
      // if (!!oldVal) await this.leaveTrajectoryChannel(oldIcao24);
      // if (!!newVal) await this.joinTrajectoryChannel(newIcao24);
    },
  },
  methods: {
    // handleNewData(data) {
    //   // console.log(`trajectory updated, ${data.length} points`);
    //   this.store.$patch({ trajectory: data });
    //   // Force polyline redraw
    //   if (this.$refs.polylineRef) {
    //     const leafletObject = this.$refs.polylineRef.leafletObject;
    //     if (leafletObject) {
    //       leafletObject.setLatLngs(data);
    //     }
    //   }
    // },
    // joinTrajectoryChannel(icao24) {
    //   return new Promise((resolve, reject) => {
    //     const channelName = `trajectory-${icao24}`;
    //     this.trajectoryChannel = this.store.socket.channel(channelName);
    //     this.trajectoryChannel.on("new-data", this.handleNewData.bind(this));

    //     this.trajectoryChannel
    //       .join()
    //       .receive("ok", ({ messages }) => {
    //         console.log(`(${channelName}) joined`, messages);
    //         resolve(messages);
    //       })
    //       .receive("error", ({ reason }) => {
    //         console.log(`failed to join ${channelName}`, reason);
    //         reject(reason);
    //       })
    //       .receive("timeout", () => {
    //         console.log(`timeout joining ${channelName}`);
    //         reject('timeout');
    //       });
    //   });
    // },
    // leaveTrajectoryChannel(icao24) {
    //   return new Promise((resolve, reject) => {
    //     const channelName = `trajectory-${icao24}`;
    //     console.log(`leaving channel ${channelName} ...`);;
    //     if (!!this.trajectoryChannel) {
    //       console.log(`never joined channel ${channelName}`);
    //       resolve('not-found');
    //     }
    //     console.log('leave channel', this.trajectoryChannel);
    //     this.trajectoryChannel.leave()
    //       .receive("ok", ({ messages }) => {
    //         console.log(`(${channelName}) left`, messages);
    //         this.trajectoryChannel = null;
    //         resolve(messages);
    //       })
    //       .receive("error", ({ reason }) => {
    //         console.log(`failed to leave ${channelName}`, reason);
    //         reject(new Error(reason));
    //       })
    //       .receive("timeout", () => {
    //         console.log(`timeout leaving ${channelName}`);
    //         reject(new Error('timeout'));
    //       });
    //   });
    // },
  },
};
</script>

<style>
.tooltip {
  border-radius: 10px;
}
</style>
