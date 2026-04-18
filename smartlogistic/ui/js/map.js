/* =========================================================
   map.js — Leaflet Map Manager (OSRM Real Road Network)
   Interactive map showing delivery routes and stops.
   Two map instances: dashboard + route optimizer.
   ========================================================= */

// ─── OSRM helper: fetch real road geometry ───
const osrmRouteCache = new Map();

function routeKey(points) {
  return points
    .map(p => `${Number(p[0]).toFixed(5)},${Number(p[1]).toFixed(5)}`)
    .join('|');
}

async function fetchOSRMRoute(points) {
  if (!points || points.length < 2) return points;

  const key = routeKey(points);
  if (osrmRouteCache.has(key)) {
    return osrmRouteCache.get(key);
  }

  // OSRM expects [longitude, latitude]
  const coordString = points.map(p => `${p[1]},${p[0]}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const data     = await response.json();
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      // Convert back to Leaflet's [lat, lng] format
      const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
      osrmRouteCache.set(key, coords);
      if (osrmRouteCache.size > 120) {
        const firstKey = osrmRouteCache.keys().next().value;
        osrmRouteCache.delete(firstKey);
      }
      return coords;
    }
    return points;
  } catch (err) {
    console.warn('[OSRM] Road directions unavailable, using straight lines:', err);
    return points;
  }
}

// ─── DASHBOARD MAP ───
const MapManager = {
  map: null,
  markers: [],
  polylines: [],
  markerGroup: null,

  init() {
    this.map = L.map('map', {
      zoomControl: false,
      attributionControl: true
    }).setView([39.55, 37.15], 10);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(this.map);

    L.control.zoom({ position: 'topleft' }).addTo(this.map);
    this.markerGroup = L.layerGroup().addTo(this.map);
    console.log('[Map] Initialized on Sivas region');
  },

  clear() {
    this.markerGroup.clearLayers();
    this.polylines.forEach(p => this.map.removeLayer(p));
    this.polylines = [];
    this.markers   = [];
  },

  createStopMarker(stop, routeColor) {
    const delayColor = stop.delay > 15 ? '#ef4444'
                     : stop.delay > 5  ? '#f59e0b'
                     :                   '#10b981';

    const marker = L.circleMarker([stop.lat, stop.lng], {
      radius:      7,
      fillColor:   delayColor,
      color:       routeColor,
      weight:      2,
      opacity:     0.9,
      fillOpacity: 0.8
    });

    marker.bindPopup(`
      <div style="font-family: 'Space Grotesk', sans-serif; min-width: 180px;">
        <div style="font-weight: 700; font-size: 13px; margin-bottom: 6px; color: #1e293b;">
          📍 Stop #${stop.seq} — ${stop.stopId}
        </div>
        <div style="font-size: 11px; color: #64748b; line-height: 1.7;">
          <b>Road:</b> ${stop.roadType}<br>
          <b>Delay:</b> <span style="color: ${delayColor}; font-weight: 700;">${stop.delay.toFixed(1)} min</span><br>
          <b>Delay Probability:</b> ${(stop.delayProb * 100).toFixed(0)}%<br>
          <b>Packages:</b> ${stop.packages} (${stop.weight} kg)<br>
          <b>Planned:</b> ${stop.planned || '—'}<br>
          <b>Actual:</b> ${stop.actual || '—'}
        </div>
      </div>
    `, { maxWidth: 280 });

    return marker;
  },

  async plotRoute(routeId, stops, color) {
    if (!stops || stops.length === 0) return;

    const coords     = stops.map(s => [s.lat, s.lng]);

    // Dashboard must stay responsive: draw straight line immediately.
    const polyline = L.polyline(coords, {
      color,
      weight:       3,
      opacity:      0.7,
      smoothFactor: 1.5
    }).addTo(this.map);

    fetchOSRMRoute(coords).then((roadCoords) => {
      if (roadCoords && roadCoords.length > 1) {
        polyline.setLatLngs(roadCoords);
      }
    }).catch(() => null);

    polyline.bindPopup(`<b>${routeId}</b> — ${stops.length} stops`);
    this.polylines.push(polyline);

    stops.forEach(stop => {
      const marker = this.createStopMarker(stop, color);
      this.markerGroup.addLayer(marker);
      this.markers.push(marker);
    });
  },

  async plotAllRoutes(dataStore, maxRoutes = 15) {
    this.clear();

    const routeColors = [
      '#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b',
      '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
      '#84cc16', '#0ea5e9', '#d946ef', '#22d3ee', '#a855f7'
    ];

    const routeIds = dataStore.getRouteIds().slice(0, maxRoutes);

    for (let idx = 0; idx < routeIds.length; idx++) {
      const routeId = routeIds[idx];
      const stops   = dataStore.getStopCoordinates(routeId);
      const color   = routeColors[idx % routeColors.length];
      await this.plotRoute(routeId, stops, color);
    }

    if (this.markers.length > 0) {
      const allCoords = this.markers.map(m => m.getLatLng());
      const bounds    = L.latLngBounds(allCoords);
      this.map.fitBounds(bounds, { padding: [30, 30] });
    }

    console.log(`[Map] Plotted ${routeIds.length} routes with ${this.markers.length} stops`);
  },

  async highlightRoute(routeId, dataStore) {
    this.polylines.forEach(p => p.setStyle({ opacity: 0.2 }));
    const stops = dataStore.getStopCoordinates(routeId);
    if (stops.length > 0) {
      const routeCoords = await fetchOSRMRoute(stops.map(s => [s.lat, s.lng]));
      const highlight = L.polyline(
        routeCoords,
        { color: '#3b82f6', weight: 5, opacity: 1 }
      ).addTo(this.map);
      this.polylines.push(highlight);
      const bounds = L.latLngBounds(stops.map(s => [s.lat, s.lng]));
      this.map.fitBounds(bounds, { padding: [50, 50] });
    }
  },

  invalidateSize() {
    if (this.map) setTimeout(() => this.map.invalidateSize(), 100);
  }
};


// ─── ROUTE OPTIMIZER MAP ───
const OptimizeMap = {
  map:         null,
  layers: {
    original:  null,
    optimized: null,
    markers:   null,
    labels:    null
  },
  renderToken: 0,
  initialized: false,

  init() {
    if (this.initialized) return;

    this.map = L.map('optimizeMap', {
      zoomControl: false,
      attributionControl: true
    }).setView([39.55, 37.15], 10);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(this.map);

    L.control.zoom({ position: 'topleft' }).addTo(this.map);

    this.layers.original  = L.layerGroup().addTo(this.map);
    this.layers.optimized = L.layerGroup().addTo(this.map);
    this.layers.markers   = L.layerGroup().addTo(this.map);
    this.layers.labels    = L.layerGroup().addTo(this.map);

    this.initialized = true;
    console.log('[OptimizeMap] Initialized');
  },

  clear() {
    Object.values(this.layers).forEach(layer => {
      if (layer) layer.clearLayers();
    });
  },

  async showRoute(stops, routeId) {
    this.clear();
    if (!stops || stops.length === 0) return;
    const token = ++this.renderToken;

    const coords     = stops.map(s => [s.lat, s.lng]);

    const polyline = L.polyline(coords, {
      color:       '#3b82f6',
      weight:      4,
      opacity:     0.8,
      smoothFactor: 1.5
    });
    this.layers.original.addLayer(polyline);

    fetchOSRMRoute(coords).then((roadCoords) => {
      if (token !== this.renderToken) return;
      if (roadCoords && roadCoords.length > 1) {
        polyline.setLatLngs(roadCoords);
      }
    }).catch(() => null);

    stops.forEach(stop => {
      const delayColor = stop.delay > 15 ? '#ef4444'
                       : stop.delay > 5  ? '#f59e0b'
                       :                   '#10b981';
      const probColor  = stop.delayProb > 0.5  ? '#ef4444'
                       : stop.delayProb > 0.25 ? '#f59e0b'
                       :                          '#10b981';

      const marker = L.circleMarker([stop.lat, stop.lng], {
        radius: 12, fillColor: delayColor, color: '#ffffff',
        weight: 2,  opacity: 1, fillOpacity: 0.9
      });

      marker.bindPopup(`
        <div style="font-family: 'Space Grotesk', sans-serif; min-width: 220px;">
          <div style="font-weight: 700; font-size: 14px; margin-bottom: 8px; color: #1e293b;">
            📍 Stop #${stop.seq} — ${stop.stopId}
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 11px; color: #64748b;">
            <div><b>Road:</b> ${stop.roadType}</div>
            <div><b>Packages:</b> ${stop.packages}</div>
            <div><b>Weight:</b> ${stop.weight} kg</div>
            <div><b>Delay Prob:</b> <span style="color: ${probColor}; font-weight: 700;">${(stop.delayProb * 100).toFixed(0)}%</span></div>
          </div>
          <div style="margin-top: 8px; padding: 8px; background: ${delayColor}15; border-radius: 6px; border-left: 3px solid ${delayColor};">
            <div style="font-size: 12px; font-weight: 700; color: ${delayColor};">
              ${stop.delay > 15 ? '⚠️ HIGH DELAY' : stop.delay > 5 ? '🟡 MODERATE' : '✅ ON TIME'}:
              ${stop.delay.toFixed(1)} min delay
            </div>
            <div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">
              Planned: ${stop.planned || '—'} → Actual: ${stop.actual || '—'}
            </div>
          </div>
          ${stop.missedWindow ? '<div style="margin-top: 6px; color: #ef4444; font-size: 11px; font-weight: 700;">❌ MISSED TIME WINDOW</div>' : ''}
        </div>
      `, { maxWidth: 320 });

      this.layers.markers.addLayer(marker);

      const label = L.divIcon({
        className: 'stop-number-label',
        html: `<div style="
          width: 20px; height: 20px;
          background: ${delayColor}; color: white;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 700;
          font-family: 'Space Grotesk', sans-serif;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          border: 1px solid white;
        ">${stop.seq}</div>`,
        iconSize:   [20, 20],
        iconAnchor: [10, 10]
      });

      this.layers.labels.addLayer(
        L.marker([stop.lat, stop.lng], { icon: label, interactive: false })
      );
    });

    const bounds = L.latLngBounds(coords);
    this.map.fitBounds(bounds, { padding: [40, 40] });
    console.log(`[OptimizeMap] Showing route ${routeId} with ${stops.length} stops`);
  },

  async showOptimizedRoute(originalStops, optimizedStops) {
    const token = ++this.renderToken;

    // Remove original route overlay and keep only the optimized route.
    this.layers.original.clearLayers();
    this.layers.optimized.clearLayers();

    const coords     = optimizedStops.map(s => [s.lat, s.lng]);

    const optPolyline = L.polyline(coords, {
      color:       '#10b981',
      weight:      5,
      opacity:     0.9,
      smoothFactor: 1.5
    });
    this.layers.optimized.addLayer(optPolyline);

    fetchOSRMRoute(coords).then((roadCoords) => {
      if (token !== this.renderToken) return;
      if (roadCoords && roadCoords.length > 1) {
        optPolyline.setLatLngs(roadCoords);
      }
    }).catch(() => null);

    // Update numbered labels with new order
    this.layers.labels.clearLayers();
    optimizedStops.forEach((stop, idx) => {
      const label = L.divIcon({
        className: 'stop-number-label',
        html: `<div style="
          width: 22px; height: 22px;
          background: #10b981; color: white;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700;
          font-family: 'Space Grotesk', sans-serif;
          box-shadow: 0 2px 8px rgba(16,185,129,0.4);
          border: 2px solid white;
        ">${idx + 1}</div>`,
        iconSize:   [22, 22],
        iconAnchor: [11, 11]
      });
      this.layers.labels.addLayer(
        L.marker([stop.lat, stop.lng], { icon: label, interactive: false })
      );
    });

    document.getElementById('optMapLegendOriginal').style.display = 'inline-flex';
    document.getElementById('optMapLegendOptimized').style.display = 'inline-flex';
    console.log('[OptimizeMap] Optimized route overlay applied');
  },

  invalidateSize() {
    if (this.map) setTimeout(() => this.map.invalidateSize(), 150);
  }
};