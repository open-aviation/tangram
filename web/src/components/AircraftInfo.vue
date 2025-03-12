<template>
    <div id="metadata" v-if="aircraft">
        <span id="typecode" v-if="aircraft.typecode">
            {{ aircraft.typecode }}</span>
        <span>{{ aircraft.callsign }}</span>
        <span id="icao24">{{ aircraft.icao24 }}</span><br />
        <span id="registration" v-if="aircraft.registration">
            Registration: {{ aircraft.registration }} </span><br />
    </div>
    <plugin-citypair />
</template>

<script>
import { useMapStore } from "../store";
export default {
    data() {
        return {
            store: useMapStore()
        }
    },
    computed: {
        aircraft() {
            return this.store.selectedPlane;
        },
    },
}
</script>

<style scoped>
#metadata {
    margin-bottom: 10px;
}

#registration {
    font-size: 10pt;
}

#icao24 {
    font-family: "Inconsolata", monospace;
    float: right;
    margin-right: 3px;
    border: 1px solid #f2cf5b;
    border-radius: 5px;
    background-color: #f2cf5b;
    padding: 2px 5px;
    font-size: 10pt;
}

#icao24::before {
    content: "0x";
    color: #79706e;
    font-size: 95%;
}

#typecode {
    border: 1px solid #4c78a8;
    background-color: #4c78a8;
    color: white;
    border-radius: 5px;
    padding: 2px 5px;
    font-family: "Roboto Condensed", sans-serif;
    font-size: 10pt;
    float: right;
}

h5 {
    font-family: "B612", sans-serif;
    font-size: 12pt;
}
</style>
