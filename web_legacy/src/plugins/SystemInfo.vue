<template>
    <div>
        <ul class="nav nav-tabs navbar-nav">
            <li class="nav-item clock" @mouseover="hovered = true"
                @mouseleave="hovered = false">
                <span id="info_time" v-html="hovered ? local_time : utc_time">
                </span>
            </li>
            <span id="uptime" v-html="uptime"></span>
        </ul>
    </div>
</template>

<script>
import { useMapStore } from "@store"; // use the alias instead of relative path

export default {
    data() {
        return {
            hovered: false,
            store: useMapStore(),
        };
    },
    computed: {
        utc_time() {
            const date = this.store.info_utc ? new Date(this.store.info_utc) : new Date();
            const hours = date.getUTCHours().toString().padStart(2, "0");
            const minutes = date.getUTCMinutes().toString().padStart(2, "0");
            const seconds = date.getUTCSeconds().toString().padStart(2, "0");
            return `${hours}:${minutes}:${seconds} Z`;
        },
        local_time() {
            const date = new Date(this.store.info_utc); // to local time
            return date.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
                timeZoneName: "shortOffset",
            });
        },
        uptime() {
            return this.store.uptime;
        },
    },
};
</script>

<style scoped>
#uptime {
    color: #79706e;
    font-size: 9pt;
    text-align: center;
}

.nav {
    align-items: center;
}
</style>
