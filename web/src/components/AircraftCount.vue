<template>
    <div class="visible_aircraft_box">
        <ul class="nav nav-tabs navbar-nav">
            <li class="nav-item li-center">
                <span id="visible_count" v-html="visible"></span> (<span
                    id="plane_count" v-html="count"></span>)
            </li>
            <span id="count_aircraft">visible aircraft</span>
        </ul>
    </div>

</template>
<script>
import { useMapStore } from "../store";

export default {
    data() {
        return {
            store: useMapStore(),
        };
    },
    computed: {
        count() {
            return this.store.count;
        },
        visible() {
            return this.store.visible;
        },
    },
};
</script>

<style scoped>
#visible_count {
    font-size: 1.em;
    color: #4c78a8;
}

#count_aircraft {
    color: #79706e;
    font-size: 9pt;
    text-align: center;
}

.visible_aircraft_box {
    margin-right: 1em;
}

.li-center {
    text-align: center;
}
</style>
