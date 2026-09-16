<script setup lang="ts">
/**
 * Reusable Line Chart Component
 * Built with Chart.js and vue-chartjs
 */

import { computed } from 'vue'
import { Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
  type ChartData
} from 'chart.js'

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

interface Props {
  labels: string[]
  datasets: {
    label: string
    data: number[]
    borderColor?: string
    backgroundColor?: string
    fill?: boolean
  }[]
  title?: string
  height?: number
}

const props = withDefaults(defineProps<Props>(), {
  height: 300
})

const chartData = computed<ChartData<'line'>>(() => ({
  labels: props.labels,
  datasets: props.datasets.map((dataset, index) => ({
    label: dataset.label,
    data: dataset.data,
    borderColor: dataset.borderColor || getColorForIndex(index),
    backgroundColor: dataset.backgroundColor || getBackgroundColorForIndex(index),
    fill: dataset.fill ?? true,
    tension: 0.4,
    borderWidth: 2,
    pointRadius: 3,
    pointHoverRadius: 5,
    pointBackgroundColor: dataset.borderColor || getColorForIndex(index),
    pointBorderColor: '#1a1a2e',
    pointBorderWidth: 2
  }))
}))

const chartOptions = computed<ChartOptions<'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: true,
      position: 'top',
      labels: {
        color: '#e0e0e0',
        font: {
          family: 'Inter, sans-serif',
          size: 12
        },
        usePointStyle: true,
        padding: 15
      }
    },
    title: {
      display: !!props.title,
      text: props.title,
      color: '#ffffff',
      font: {
        family: 'Inter, sans-serif',
        size: 16,
        weight: 'bold'
      },
      padding: {
        top: 10,
        bottom: 20
      }
    },
    tooltip: {
      backgroundColor: 'rgba(26, 26, 46, 0.95)',
      titleColor: '#ffffff',
      bodyColor: '#e0e0e0',
      borderColor: 'rgba(138, 43, 226, 0.5)',
      borderWidth: 1,
      padding: 12,
      cornerRadius: 8,
      displayColors: true,
      callbacks: {
        label: (context) => {
          const label = context.dataset.label || ''
          const value = context.parsed.y
          return `${label}: ${value.toLocaleString()}`
        }
      }
    }
  },
  scales: {
    x: {
      grid: {
        color: 'rgba(255, 255, 255, 0.05)',
        drawBorder: false
      },
      ticks: {
        color: '#9ca3af',
        font: {
          family: 'Inter, sans-serif',
          size: 11
        }
      }
    },
    y: {
      beginAtZero: true,
      grid: {
        color: 'rgba(255, 255, 255, 0.05)',
        drawBorder: false
      },
      ticks: {
        color: '#9ca3af',
        font: {
          family: 'Inter, sans-serif',
          size: 11
        },
        callback: (value) => {
          if (typeof value === 'number') {
            return value.toLocaleString()
          }
          return value
        }
      }
    }
  },
  interaction: {
    intersect: false,
    mode: 'index'
  }
}))

/** Used only to satisfy the indexed-access check; the modulo cannot miss. */
const FALLBACK_COLOR = '#8a2be2'
const FALLBACK_BACKGROUND = 'rgba(138, 43, 226, 0.1)'

const getColorForIndex = (index: number): string => {
  const colors = [
    '#8a2be2', // Primary purple
    '#00d4ff', // Cyan
    '#ff6b6b', // Red
    '#51cf66', // Green
    '#ffd43b', // Yellow
    '#ff6bcb'  // Pink
  ]
  return colors[index % colors.length] ?? FALLBACK_COLOR
}

const getBackgroundColorForIndex = (index: number): string => {
  const colors = [
    'rgba(138, 43, 226, 0.1)',
    'rgba(0, 212, 255, 0.1)',
    'rgba(255, 107, 107, 0.1)',
    'rgba(81, 207, 102, 0.1)',
    'rgba(255, 212, 59, 0.1)',
    'rgba(255, 107, 203, 0.1)'
  ]
  return colors[index % colors.length] ?? FALLBACK_BACKGROUND
}
</script>

<template>
  <div class="line-chart-wrapper" :style="{ height: `${height}px` }">
    <Line :data="chartData" :options="chartOptions" />
  </div>
</template>

<style scoped>
.line-chart-wrapper {
  position: relative;
  width: 100%;
}
</style>
