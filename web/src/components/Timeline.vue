<template>
  <div class="timeline-container" :style="styles">
    <div class="timeline-flex" :class="{'flex-row' : direction !== 'col', 'flex-col': direction === 'col'}">
      <div :style="{'z-index': styles.zIndex + 1 || '401'}" :class="{'progress-row' : direction !== 'col', 'progress-col': direction === 'col'}" ></div>
      <div v-for="(item, index) in dateArray" :style="{width: (100 / dateArray.length) + '%'}" :key="index" class="date-block">
        <div style="width: 100%; display: flex;">
          <div v-for="num in ticks" :key="num" :style="{width: (100 / ticks.length) + '%'}" :class="{'ticks-row' : direction !== 'col', 'ticks-col': direction === 'col'}">
            <span v-if="num !== '00'" class="tick-num" :class="{'tick-num-row' : direction !== 'col', 'tick-num-col': direction === 'col'}">{{num}}</span>
          </div>
        </div>
        <div class="date-content">{{ item.format(dateFormat) }}</div>
      </div>
    </div>
  </div>
</template>

<script>
import dayjs from 'dayjs'
export default {
  props: {
    styles: {
      type: Object,
      default: {}
    },
    unitNum: {
      type: Number,
      default: 8
    },
    dateFormat: {
      type: String,
      default: 'MM-DD'
    },
    showToolTip: {
      type: Boolean,
      default: true
    },
    showTime: {
      type: Boolean,
      default: true
    },
    showTick: {
      type: Boolean,
      default: true
    },
    draggable: {
      type: Boolean,
      default: true
    },
    dateArray: {
      type: Array,
      default: () => [dayjs().subtract(3, 'day'), dayjs().subtract(2, 'day'), dayjs().subtract(1, 'day'), dayjs(), dayjs().add(1, 'day'), dayjs().add(2, 'day'), dayjs().add(1, 'day')]
    },
    currentTime: {
      type: Object,
      default: () => dayjs()
    },
    direction: {
      type: String,
      default: 'row'
    }
  },
  computed: {
    ticks() {
      let arr = []
      for(let i = 0; i < this.unitNum; i++) {
        const time = 24 / this.unitNum
        const timeTxt = i * time < 10 ? '0' + i*time : i * time
        arr.push(timeTxt)
      }
      return arr
    }
  }
}
</script>
<style>
.timeline-container {
  z-index: 100;
  cursor: default;
}

.timeline-container .timeline-flex {
  display: flex;
  position: relative;
}

.timeline-container .flex-row {
  flex-direction: row;
  width: 100%;
}

.timeline-container .flex-col {
  flex-direction: column;
  height: 100%;
}

.timeline-container .date-block {
  text-align: center;
  border-right: 1px solid #808080;
  border-top: 1px solid #808080;
}
.timeline-container .date-block:first-child {
  border-left: none;
}
.timeline-container .date-block .date-content {
  padding-top: 10px ;
  padding-bottom: 5px;
}
.timeline-container .ticks-row {
  border-left: 1px solid #808080;
  font-size: 8px;
  height: 8px;
  width: 8px;
  position: relative;
}
.timeline-container .date-block .ticks-row:first-child {
  border-left: none;
}
.timeline-container .tick-num {
  position: absolute;
}
.timeline-container .tick-num-row {
  left: 0;
  transform: translateX(-50%);
  top: 10px
}
.timeline-container .tick-num-col {
  top: 0;
  transform: translateY(-50%);
  left: 5px
}
.timeline-container .progress-row {
  width: 100%;
  height: 10px;
  position: absolute;
  top: 0;
  left: 0;
  background: #00000030;
  cursor: pointer;
}
</style>
