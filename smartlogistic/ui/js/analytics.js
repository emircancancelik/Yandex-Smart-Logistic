/* =========================================================
   analytics.js — Charts & Analytics View
   Chart.js visualizations from CSV data
   ========================================================= */

const Analytics = {
  charts: {},

  /** Chart.js global defaults for dark theme */
  setDefaults() {
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.1)';
    Chart.defaults.font.family = "'Space Grotesk', sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.padding = 16;
  },

  /** Render all analytics charts */
  render(dataStore) {
    this.setDefaults();
    this.renderSummary(dataStore);
    this.renderDelayByWeather(dataStore);
    this.renderDelayByTraffic(dataStore);
    this.renderVehicleType(dataStore);
    this.renderOnTimeRate(dataStore);
  },

  /** Update summary stats */
  renderSummary(dataStore) {
    const summary = dataStore.getAnalyticsSummary();
    document.getElementById('statTotalRoutes').textContent = summary.totalRoutes || '—';
    document.getElementById('statAvgDelay').textContent = summary.avgDelay ? `${summary.avgDelay}` : '—';
    document.getElementById('statMaxDelay').textContent = summary.maxDelay ? `${summary.maxDelay}` : '—';
    document.getElementById('statAvgOnTime').textContent = summary.avgOnTime ? `${summary.avgOnTime}%` : '—';
    document.getElementById('statTotalDistance').textContent = summary.totalDistance ? Number(summary.totalDistance).toLocaleString() : '—';
  },

  /** Bar chart: Average delay by weather condition */
  renderDelayByWeather(dataStore) {
    const data = dataStore.groupDelayBy('weather_condition');
    const labels = Object.keys(data);
    const values = Object.values(data);

    const weatherColors = {
      'clear': '#fbbf24',
      'cloudy': '#94a3b8',
      'rain': '#3b82f6',
      'snow': '#e2e8f0',
      'fog': '#64748b',
      'wind': '#06b6d4'
    };

    const colors = labels.map(l => weatherColors[l] || '#8b5cf6');

    this.destroyChart('chartDelayByWeather');
    this.charts.chartDelayByWeather = new Chart(
      document.getElementById('chartDelayByWeather'),
      {
        type: 'bar',
        data: {
          labels: labels.map(l => l.charAt(0).toUpperCase() + l.slice(1)),
          datasets: [{
            label: 'Avg Delay (min)',
            data: values,
            backgroundColor: colors.map(c => c + '40'),
            borderColor: colors,
            borderWidth: 2,
            borderRadius: 8,
            barPercentage: 0.6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            y: {
              beginAtZero: true,
              title: { display: true, text: 'Minutes', font: { size: 11 } },
              grid: { color: 'rgba(148, 163, 184, 0.06)' }
            },
            x: {
              grid: { display: false }
            }
          }
        }
      }
    );
  },

  /** Bar chart: Average delay by traffic level */
  renderDelayByTraffic(dataStore) {
    const data = dataStore.groupDelayBy('traffic_level');
    const order = ['low', 'moderate', 'high'];
    const labels = order.filter(k => data[k] !== undefined);
    const values = labels.map(k => data[k]);

    const trafficColors = {
      'low': '#10b981',
      'moderate': '#f59e0b',
      'high': '#ef4444'
    };

    this.destroyChart('chartDelayByTraffic');
    this.charts.chartDelayByTraffic = new Chart(
      document.getElementById('chartDelayByTraffic'),
      {
        type: 'bar',
        data: {
          labels: labels.map(l => l.charAt(0).toUpperCase() + l.slice(1)),
          datasets: [{
            label: 'Avg Delay (min)',
            data: values,
            backgroundColor: labels.map(l => trafficColors[l] + '40'),
            borderColor: labels.map(l => trafficColors[l]),
            borderWidth: 2,
            borderRadius: 8,
            barPercentage: 0.5
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            y: {
              beginAtZero: true,
              title: { display: true, text: 'Minutes', font: { size: 11 } },
              grid: { color: 'rgba(148, 163, 184, 0.06)' }
            },
            x: {
              grid: { display: false }
            }
          }
        }
      }
    );
  },

  /** Doughnut chart: Vehicle type distribution */
  renderVehicleType(dataStore) {
    const data = dataStore.countBy('vehicle_type');
    const labels = Object.keys(data);
    const values = Object.values(data);

    const colors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981'];

    this.destroyChart('chartVehicleType');
    this.charts.chartVehicleType = new Chart(
      document.getElementById('chartVehicleType'),
      {
        type: 'doughnut',
        data: {
          labels: labels.map(l => l.charAt(0).toUpperCase() + l.slice(1)),
          datasets: [{
            data: values,
            backgroundColor: colors.slice(0, labels.length).map(c => c + '80'),
            borderColor: colors.slice(0, labels.length),
            borderWidth: 2,
            spacing: 3,
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '65%',
          plugins: {
            legend: {
              position: 'bottom',
              labels: { padding: 20 }
            }
          }
        }
      }
    );
  },

  /** Histogram: On-time rate distribution */
  renderOnTimeRate(dataStore) {
    const rates = dataStore.routes.map(r => (r.on_time_delivery_rate || 0) * 100);

    // Create buckets
    const buckets = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const counts = new Array(buckets.length - 1).fill(0);

    rates.forEach(rate => {
      for (let i = 0; i < buckets.length - 1; i++) {
        if (rate >= buckets[i] && rate < buckets[i + 1]) {
          counts[i]++;
          break;
        }
        if (rate === 100 && i === buckets.length - 2) {
          counts[i]++;
        }
      }
    });

    const labels = [];
    for (let i = 0; i < buckets.length - 1; i++) {
      labels.push(`${buckets[i]}-${buckets[i + 1]}%`);
    }

    this.destroyChart('chartOnTimeRate');
    this.charts.chartOnTimeRate = new Chart(
      document.getElementById('chartOnTimeRate'),
      {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Number of Routes',
            data: counts,
            backgroundColor: counts.map((_, i) => {
              const ratio = i / (counts.length - 1);
              if (ratio < 0.33) return 'rgba(239, 68, 68, 0.3)';
              if (ratio < 0.66) return 'rgba(245, 158, 11, 0.3)';
              return 'rgba(16, 185, 129, 0.3)';
            }),
            borderColor: counts.map((_, i) => {
              const ratio = i / (counts.length - 1);
              if (ratio < 0.33) return '#ef4444';
              if (ratio < 0.66) return '#f59e0b';
              return '#10b981';
            }),
            borderWidth: 2,
            borderRadius: 6,
            barPercentage: 0.85
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            y: {
              beginAtZero: true,
              title: { display: true, text: 'Routes', font: { size: 11 } },
              grid: { color: 'rgba(148, 163, 184, 0.06)' },
              ticks: { stepSize: 1 }
            },
            x: {
              grid: { display: false },
              ticks: { font: { size: 10 } }
            }
          }
        }
      }
    );
  },

  /** Safely destroy a chart before re-creating */
  destroyChart(key) {
    if (this.charts[key]) {
      this.charts[key].destroy();
      delete this.charts[key];
    }
  }
};
