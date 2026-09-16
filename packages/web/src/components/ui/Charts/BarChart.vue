<script setup lang="ts">
/**
 * Reusable Bar Chart Component
 * Built with Chart.js and vue-chartjs
 */

import { computed } from 'vue'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  type ChartOptions,
  type ChartData
} from 'chart.js'

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

interface Props {
  labels: string[]
  datasets: {
    label: string
    data: number[]
    backgroundColor?: string
    borderColor?: string
  }[]
  title?: string
  height?: number
  stacked?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  height: 300,
  stacked: false
})

const chartData = computed<ChartData<'bar'>>(() => ({
  labels: props.labels,
  datasets: props.datasets.map((dataset, index) => ({
    label: dataset.label,
    data: dataset.data,
    backgroundColor: dataset.backgroundColor || getColorForIndex(index),
    borderColor: dataset.borderColor || getBorderColorForIndex(index),
    borderWidth: 1,
    borderRadius: 4,
    borderSkipped: false
  }))
}))

const chartOptions = computed<ChartOptions<'bar'>>(() => ({
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
          // A skipped or gap point parses as null; Chart.js still calls
          // the label callback for it.
          const value = context.parsed.y ?? 0
          return `${label}: ${value.toLocaleString()}`
        }
      }
    }
  },
  scales: {
    x: {
      stacked: props.stacked,
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
      stacked: props.stacked,
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

const getColorForIndex = (index: number): string => {
  const colors = [
    'rgba(138, 43, 226, 0.8)', // Primary purple
    'rgba(0, 212, 255, 0.8)',  // Cyan
    'rgba(255, 107, 107, 0.8)', // Red
    'rgba(81, 207, 102, 0.8)',  // Green
    'rgba(255, 212, 59, 0.8)',  // Yellow
    'rgba(255, 107, 203, 0.8)'  // Pink
  ]
  return colors[index % colors.length] ?? FALLBACK_COLOR
}

const getBorderColorForIndex = (index: number): string => {
  const colors = [
    '#8a2be2',
    '#00d4ff',
    '#ff6b6b',
    '#51cf66',
    '#ffd43b',
    '#ff6bcb'
  ]
  return colors[index % colors.length] ?? FALLBACK_COLOR
}
</script>

<template>
  <div class="bar-chart-wrapper" :style="{ height: `${height}px` }">
    <Bar :data="chartData" :options="chartOptions" />
  </div>
</template>

<style scoped>
.bar-chart-wrapper {
  position: relative;
  width: 100%;
}
</style>
