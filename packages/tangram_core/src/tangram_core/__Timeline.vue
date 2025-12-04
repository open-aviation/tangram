<!-- NOTE: This component is a relic of tangram v0.1 and is kept for reference.
It is scheduled for removal in v0.4 when playback is properly implemented
in the backend. -->
<template>
  <div class="timeline-container" :style="styles">
    <div
      class="timeline-flex"
      :class="{ 'flex-row': direction !== 'col', 'flex-col': direction === 'col' }"
    >
      <div
        :class="{
          'progress-row': direction !== 'col',
          'progress-col': direction === 'col'
        }"
      >
        <VueSlider
          :min="dateArray[0].startOf('day').unix()"
          :max="dateArray[dateArray.length - 1].endOf('day').unix()"
          :tooltip-style="{ display: 'none' }"
          :dot-style="{ display: 'none' }"
          :process-style="{ background: '#0000bb50', borderRadius: '1px' }"
          v-model="curTime"
          :height="8"
          :dot-size="8"
          style="padding: 0"
          @change="onChangeTime"
        />
      </div>
      <div
        v-if="curTime"
        :style="{ ...getTooltip, 'z-index': styles.zIndex + 1 || '401' }"
        :class="{
          'tooltip-row': direction !== 'col',
          'tooltip-col': direction === 'col'
        }"
      >
        {{ getTooltipText() }}
      </div>
      <div
        v-for="(item, index) in dateArray"
        :key="index"
        :style="{ width: 100 / dateArray.length + '%' }"
        class="date-block"
      >
        <div style="width: 100%; display: flex">
          <div
            v-for="num in ticks"
            :key="num"
            :style="{ width: 100 / ticks.length + '%' }"
            :class="{
              'ticks-row': direction !== 'col',
              'ticks-col': direction === 'col'
            }"
          >
            <span
              v-if="num !== '00' && showTick"
              class="tick-num"
              :class="{
                'tick-num-row': direction !== 'col',
                'tick-num-col': direction === 'col'
              }"
              >{{ num }}</span
            >
          </div>
        </div>
        <div v-if="showTime" class="date-content">{{ item.format(dateFormat) }}</div>
      </div>
    </div>
  </div>
</template>

<script>
import dayjs from "dayjs";
import VueSlider from "vue-slider-component";
import "vue-slider-component/theme/antd.css";
export default {
  components: {
    VueSlider
  },
  props: {
    progressColor: {
      type: String,
      default: "#0000bb50"
    },
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
      default: "MM-DD"
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
      default: () => [
        dayjs().subtract(3, "day"),
        dayjs().subtract(2, "day"),
        dayjs().subtract(1, "day"),
        dayjs(),
        dayjs().add(1, "day"),
        dayjs().add(2, "day"),
        dayjs().add(3, "day")
      ]
    },
    currentTime: {
      type: Object,
      default: () => dayjs()
    },
    direction: {
      type: String,
      default: "row"
    }
  },
  data() {
    return {
      curTime: this.currentTime.unix()
    };
  },
  computed: {
    getTooltip() {
      const cur = this.curTime;
      const start = this.dateArray[0].startOf("day").unix();
      const end = this.dateArray[this.dateArray.length - 1].endOf("day").unix();
      if (this.direction !== "col") {
        return { left: ((cur - start) / (end - start)) * 100 + "%" };
      } else {
        return { top: ((cur - start) / (end - start)) * 100 + "%" };
      }
    },
    ticks() {
      const arr = [];
      for (let i = 0; i < this.unitNum; i++) {
        const time = 24 / this.unitNum;
        const timeTxt = i * time < 10 ? "0" + i * time : i * time;
        arr.push(timeTxt);
      }
      return arr;
    }
  },
  methods: {
    getTooltipText() {
      return dayjs.unix(this.curTime).format("HH:mm");
    },
    onChangeTime(e) {
      const num = e / 100;
      const start = this.dateArray[0].startOf("day").unix();
      const end = this.dateArray[this.dateArray.length - 1].endOf("day").unix();
      const now = (end - start) * e;
    },
    handleDragStart(e) {
      console.log(e);
      e.preventDefault();
      e.stopPropagation();
    },
    handleDrop(e) {
      console.log(e);
      e.preventDefault();
      e.stopPropagation();
    }
  }
};
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
  z-index: 1;
}

.timeline-container .date-block:first-child {
  border-left: none;
}

.timeline-container .date-block .date-content {
  padding-top: 10px;
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
  top: 10px;
}

.timeline-container .tick-num-col {
  top: 0;
  transform: translateY(-50%);
  left: 5px;
}

.timeline-container .progress-row {
  height: 10px;
  position: absolute;
  top: 0;
  width: 100%;
  left: 0;
  background: #00000030;
  cursor: pointer;
}

.timeline-container .progress-col {
  width: 10px;
  position: absolute;
  height: 100%;
  top: 0;
  left: 0;
  background: #00000030;
  cursor: pointer;
}

.timeline-container .tooltip-row {
  position: absolute;
  border-radius: 5px;
  width: 50px;
  height: 30px;
  border: 1px solid #e0e0e0;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translateX(-50%);
  top: -40px;
  background: #0000bb60;
  color: white;
}

.timeline-container .tooltip-row:after {
  top: 100%;
  left: 20px;
  border: solid transparent;
  content: " ";
  height: 0;
  width: 0;
  position: absolute;
  border-top-color: #0000bb60;
  border-width: 5px;
  margin-left: -5px;
  -moz-user-select: none;
  -webkit-user-select: none;
  -ms-user-select: none;
  -khtml-user-select: none;
  user-select: none;
}
</style>
