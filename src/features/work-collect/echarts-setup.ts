/**
 * ECharts 按需引入註冊
 *
 * 只引入實際用到的圖表模組，避免打包整個 ECharts。
 * 在 App.vue 或 work-collect 入口 import 一次即可。
 */
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, PieChart, LineChart, HeatmapChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  VisualMapComponent,
  GraphicComponent,
} from 'echarts/components'

use([
  CanvasRenderer,
  BarChart,
  PieChart,
  LineChart,
  HeatmapChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  VisualMapComponent,
  GraphicComponent,
])
