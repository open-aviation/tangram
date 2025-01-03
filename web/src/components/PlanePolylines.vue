<template>
    <l-polyline :lat-lngs="polyline" :color="color"> </l-polyline>
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
        selected: function (newVal) {
            if (newVal) {
                this.joinTrajectoryChannel(newVal.icao24);
            }
        },
    },
    methods: {
        joinTrajectoryChannel(icao24) {
            const channelName = `channel:trajectory:${icao24}`;
            // no joining token required
            let trajectoryChannel = this.store.socket.channel(channelName, { token: "okToJoin" });

            trajectoryChannel.on("new-data", (data) => {
                console.log(`${icao24} trajectory updated, ${data.length} points`);
                this.store.trajectory = data;
            });

            trajectoryChannel
                .join()
                .receive("ok", ({ messages }) => {
                    console.log(`(${channelName}) joined`, messages);
                })
                .receive("error", ({ reason }) => console.log(`failed to join ${channelName}`, reason))
                .receive("timeout", () => console.log(`timeout joining ${channelName}`));
        },
    },
};
</script>

<style>
.tooltip {
    border-radius: 10px;
}
</style>
