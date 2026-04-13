/* =========================================================
   data.js — CSV Data Loader & Parser
   Loads route data from CSV files for dashboard & analytics
   ========================================================= */

const DataStore = {
  routes: [],
  routeStops: [],
  weatherData: [],
  trafficData: [],
  delayStats: [],
  isLoaded: false,

  /** Parse a CSV string into an array of objects */
  parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().replace(/\r/g, ''));
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/\r/g, ''));
      if (values.length !== headers.length) continue;

      const obj = {};
      headers.forEach((header, idx) => {
        const val = values[idx];
        // Try to parse as number
        const num = parseFloat(val);
        obj[header] = (!isNaN(num) && val !== '' && !/^\d{4}-/.test(val)) ? num : val;
      });
      rows.push(obj);
    }
    return rows;
  },

  /** Load a CSV file relative to the data directory */
  async loadCSV(filename) {
    try {
      const response = await fetch(`../smartlogistic/data/${filename}`);
      if (!response.ok) throw new Error(`Failed to load ${filename}`);
      const text = await response.text();
      return this.parseCSV(text);
    } catch (err) {
      console.warn(`[DataStore] Could not load ${filename}:`, err.message);
      return [];
    }
  },

  /** Initialize all data */
  async init() {
    console.log('[DataStore] Loading CSV data...');

    const [routes, stops, weather, traffic, delays] = await Promise.all([
      this.loadCSV('routes.csv'),
      this.loadCSV('route_stops.csv'),
      this.loadCSV('weather_observations.csv'),
      this.loadCSV('traffic_segments.csv'),
      this.loadCSV('historical_delay_stats.csv')
    ]);

    this.routes = routes;
    this.routeStops = stops;
    this.weatherData = weather;
    this.trafficData = traffic;
    this.delayStats = delays;
    this.isLoaded = true;

    console.log(`[DataStore] Loaded: ${routes.length} routes, ${stops.length} stops, ${weather.length} weather obs, ${traffic.length} traffic segs, ${delays.length} delay stats`);

    return {
      routes: routes.length,
      stops: stops.length,
      weather: weather.length,
      traffic: traffic.length,
      delays: delays.length
    };
  },

  /** Compute KPI summary from routes data */
  getKPIs() {
    if (!this.routes.length) return { activeRoutes: 0, avgDelay: 0, onTimeRate: 0, delayedRoutes: 0 };

    const totalDelay = this.routes.reduce((s, r) => s + (r.total_delay_min || 0), 0);
    const avgDelay = totalDelay / this.routes.length;
    const avgOnTime = this.routes.reduce((s, r) => s + (r.on_time_delivery_rate || 0), 0) / this.routes.length;
    const delayed = this.routes.filter(r => (r.total_delay_min || 0) > 30).length;

    return {
      activeRoutes: this.routes.length,
      avgDelay: avgDelay.toFixed(1),
      onTimeRate: (avgOnTime * 100).toFixed(1) + '%',
      delayedRoutes: delayed
    };
  },

  /** Get routes sorted by delay (descending) */
  getRoutesByDelay() {
    return [...this.routes].sort((a, b) => (b.total_delay_min || 0) - (a.total_delay_min || 0));
  },

  /** Group and average delay by a given field */
  groupDelayBy(field) {
    const groups = {};
    this.routes.forEach(r => {
      const key = r[field] || 'unknown';
      if (!groups[key]) groups[key] = { total: 0, count: 0 };
      groups[key].total += (r.total_delay_min || 0);
      groups[key].count += 1;
    });

    const result = {};
    Object.keys(groups).forEach(k => {
      result[k] = +(groups[k].total / groups[k].count).toFixed(1);
    });
    return result;
  },

  /** Count by field value */
  countBy(field) {
    const counts = {};
    this.routes.forEach(r => {
      const key = r[field] || 'unknown';
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  },

  /** Get analytics summary */
  getAnalyticsSummary() {
    if (!this.routes.length) return {};

    const delays = this.routes.map(r => r.total_delay_min || 0);
    const distances = this.routes.map(r => r.total_distance_km || 0);

    return {
      totalRoutes: this.routes.length,
      avgDelay: (delays.reduce((a, b) => a + b, 0) / delays.length).toFixed(1),
      maxDelay: Math.max(...delays).toFixed(1),
      avgOnTime: ((this.routes.reduce((s, r) => s + (r.on_time_delivery_rate || 0), 0) / this.routes.length) * 100).toFixed(1),
      totalDistance: distances.reduce((a, b) => a + b, 0).toFixed(0)
    };
  },

  /** Get stop coordinates for mapping */
  getStopCoordinates(routeId) {
    return this.routeStops
      .filter(s => s.route_id === routeId)
      .sort((a, b) => (a.stop_sequence || 0) - (b.stop_sequence || 0))
      .map(s => ({
        lat: s.latitude,
        lng: s.longitude,
        stopId: s.stop_id,
        seq: s.stop_sequence,
        delay: s.delay_at_stop_min || 0,
        delayProb: s.delay_probability || 0,
        planned: s.planned_arrival,
        actual: s.actual_arrival,
        packages: s.package_count || 0,
        weight: s.package_weight_kg || 0,
        roadType: s.road_type || 'unknown',
        missedWindow: s.missed_time_window === 1 || s.missed_time_window === '1',
        windowOpen: s.time_window_open,
        windowClose: s.time_window_close
      }));
  },

  /** Get unique route IDs */
  getRouteIds() {
    return [...new Set(this.routeStops.map(s => s.route_id))];
  }
};
