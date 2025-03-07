<template>
    <div class="margin-right-1">
        <ul class="nav nav-tabs navbar-nav">
            <li class="nav-item li-center">
                <span id="plane_count" v-html="count"></span> (<span
                    id="visible_count" v-html="visible"></span>)
            </li>
            <span class="count_aircraft">visible aircraft</span>
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
