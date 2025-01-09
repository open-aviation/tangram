<template>
  <div class="modal-mask" v-show="visible">
    <div class="modal-wrapper">
      <div class="modal-title">Custom Url</div>
      <input style="width: 500px" placeholder="please paste the map style url (maptiler, cloudmade...)" v-model="url" />
      <div class="mt-2 d-flex justify-content-end">
        <button @click="save">Save</button>
        <button class="ml-1" @click="cancel">Cancel</button>
      </div>
    </div>
  </div>
</template>
<script>
import {useMapStore} from "../store/index.js";

export default {
  data() {
    return {
      visible: false,
      store: useMapStore(),
      url: this.hasDefault || ''
    }
  },
  computed: {
    hasDefault() {
      return this.store.getDefaultUrl
    }
  },
  methods: {
    cancel() {
      this.visible = false
    },
    save() {
      if(this.url) {
        this.store.setUrl(this.url)
        this.$emit('save', this.url)
        this.visible = false;
      }
    }
  }
}
</script>
<style scoped>
.modal-mask {
  position: fixed;
  height: 100%;
  width: 100%;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ml-1 {
  margin-left: 1rem;
}
.modal-wrapper {
  margin: auto;
  background: white;
  border-radius: 20px;
  z-index: 1005;
  padding: 20px;
}
</style>
