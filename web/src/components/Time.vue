<template>
    <div>
        <ul class="nav nav-tabs navbar-nav">
            <li class="nav-item clock" @mouseover="hovered = true" @mouseleave="hovered = false">
                <span id="info_time" v-html="hovered ? info_local : info_utc">
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
        info_utc() {
            return this.store.info_utc;
        },
        info_local() {
            return this.store.local_time;
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
