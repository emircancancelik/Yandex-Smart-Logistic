/* =========================================================
   map.js — Leaflet Map Manager (OSRM Real Road Network)
   Interactive map showing delivery routes and stops
   Supports two map instances: dashboard + optimization
   ========================================================= */

// ─── OSRM YARDIMCI FONKSİYONU (Nesnelerin dışında, global) ───
async function fetchOSRMRoute(points) {
  if (!points || points.length < 2) return points; // En az 2 nokta lazım
  
  // OSRM [longitude, latitude] formatını bekler
  const coordString = points.map(p => `${p[1]},${p[0]}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      // Gelen veriyi Leaflet'in beklediği [latitude, longitude] formatına geri çevirir
      return data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
    }
    return points; // Hata durumunda kuş uçuşu düz çizgiye geri dön
  } catch (err) {
    console.warn('[OSRM] Yol tarifi alınamadı, düz çizgi kullanılıyor:', err);
    return points;
  }
}

// ─── DASHBOARD HARİTASI ───
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
    this.markers = [];
  },

  createStopMarker(stop, routeColor) {
    const delayColor = stop.delay > 15 ? '#ef4444' :
                       stop.delay > 5  ? '#f59e0b' : '#10b981';

    const marker = L.circleMarker([stop.lat, stop.lng], {
      radius: 7,
      fillColor: delayColor,
      color: routeColor,
      weight: 2,
      opacity: 0.9,
      fillOpacity: 0.8
    });

    marker.bindPopup(`
      <div style="font-family: 'Inter', sans-serif; min-width: 180px;">
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

  // DİKKAT: Artık asenkron (async) çalışıyor
  async plotRoute(routeId, stops, color) {
    if (!stops || stops.length === 0) return;

    const coords = stops.map(s => [s.lat, s.lng]);
    
    // OSRM'den gerçek yol koordinatlarını çek
    const roadCoords = await fetchOSRMRoute(coords);

    // Düz çizgi (coords) yerine gerçek yolları (roadCoords) çiz
    const polyline = L.polyline(roadCoords, {
      color: color,
      weight: 3,
      opacity: 0.7,
      dashArray: null,
      smoothFactor: 1.5
    }).addTo(this.map);

    polyline.bindPopup(`<b>${routeId}</b> — ${stops.length} stops`);
    this.polylines.push(polyline);

    stops.forEach(stop => {
      const marker = this.createStopMarker(stop, color);
      this.markerGroup.addLayer(marker);
      this.markers.push(marker);
    });
  },

  // DİKKAT: Çoklu çizim yaparken await kullanabilmek için forEach yerine for...of kullanıldı
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
      const stops = dataStore.getStopCoordinates(routeId);
      const color = routeColors[idx % routeColors.length];
      await this.plotRoute(routeId, stops, color); // Asenkron bekleme
    }

    if (this.markers.length > 0) {
      const allCoords = this.markers.map(m => m.getLatLng());
      const bounds = L.latLngBounds(allCoords);
      this.map.fitBounds(bounds, { padding: [30, 30] });
    }

    console.log(`[Map] Plotted ${routeIds.length} routes with ${this.markers.length} stops`);
  },

  highlightRoute(routeId, dataStore) {
    this.polylines.forEach(p => p.setStyle({ opacity: 0.2 }));
    const stops = dataStore.getStopCoordinates(routeId);
    if (stops.length > 0) {
      // Highlight için basitleştirilmiş düz çizgi kullanabiliriz veya OSRM eklenebilir
      const highlight = L.polyline(
        stops.map(s => [s.lat, s.lng]),
        { color: '#3b82f6', weight: 5, opacity: 1 }
      ).addTo(this.map);

      this.polylines.push(highlight);
      const bounds = L.latLngBounds(stops.map(s => [s.lat, s.lng]));
      this.map.fitBounds(bounds, { padding: [50, 50] });
    }
  },

  resetHighlight() {
    this.polylines.forEach(p => p.setStyle({ opacity: 0.7 }));
  },

  invalidateSize() {
    if (this.map) {
      setTimeout(() => this.map.invalidateSize(), 100);
    }
  }
};


// ─── OPTIMIZATION HARİTASI (AI KARARLARI) ───
const OptimizeMap = {
  map: null,
  layers: {
    original: null,
    optimized: null,
    markers: null,
    labels: null
  },
  initialized: false,

  init() {
    if (this.initialized) return;

    this.map = L.map('optimizeMap', {
      zoomControl: false,
      attributionControl: true
    }).setView([39.55, 37.15], 10);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(this.map);

    L.control.zoom({ position: 'topleft' }).addTo(this.map);

    this.layers.original = L.layerGroup().addTo(this.map);
    this.layers.optimized = L.layerGroup().addTo(this.map);
    this.layers.markers = L.layerGroup().addTo(this.map);
    this.layers.labels = L.layerGroup().addTo(this.map);

    this.initialized = true;
    console.log('[OptimizeMap] Initialized');
  },

  clear() {
    Object.values(this.layers).forEach(layer => {
      if (layer) layer.clearLayers();
    });
  },

  // DİKKAT: Artık asenkron çalışıyor
  async showRoute(stops, routeId) {
    this.clear();
    if (!stops || stops.length === 0) return;

    const coords = stops.map(s => [s.lat, s.lng]);
    
    // Orijinal rota için gerçek yol ağını al
    const roadCoords = await fetchOSRMRoute(coords);

    const polyline = L.polyline(roadCoords, {
      color: '#3b82f6',
      weight: 4,
      opacity: 0.8,
      smoothFactor: 1.5
    });
    this.layers.original.addLayer(polyline);

    stops.forEach((stop, idx) => {
      const delayColor = stop.delay > 15 ? '#ef4444' :
                         stop.delay > 5  ? '#f59e0b' : '#10b981';

      const probColor = stop.delayProb > 0.5 ? '#ef4444' :
                        stop.delayProb > 0.25 ? '#f59e0b' : '#10b981';

      const marker = L.circleMarker([stop.lat, stop.lng], {
        radius: 12,
        fillColor: delayColor,
        color: '#ffffff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9
      });

      marker.bindPopup(`
        <div style="font-family: 'Inter', sans-serif; min-width: 220px;">
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
          font-family: 'Inter', sans-serif;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          border: 1px solid white;
        ">${stop.seq}</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });

      const labelMarker = L.marker([stop.lat, stop.lng], { icon: label, interactive: false });
      this.layers.labels.addLayer(labelMarker);
    });

    const bounds = L.latLngBounds(coords);
    this.map.fitBounds(bounds, { padding: [40, 40] });
    console.log(`[OptimizeMap] Showing route ${routeId} with ${stops.length} stops`);
  },

  // DİKKAT: Artık asenkron çalışıyor
  async showOptimizedRoute(originalStops, optimizedStops) {
    this.layers.original.eachLayer(layer => {
      if (layer.setStyle) layer.setStyle({ opacity: 0.3, dashArray: '8 4' });
    });

    const coords = optimizedStops.map(s => [s.lat, s.lng]);
    
    // AI tarafından optimize edilmiş rota için gerçek yol ağını al
    const roadCoords = await fetchOSRMRoute(coords);

    const optPolyline = L.polyline(roadCoords, {
      color: '#10b981', // Yeşil (AI Onayı)
      weight: 5,
      opacity: 0.9,
      smoothFactor: 1.5
    });
    this.layers.optimized.addLayer(optPolyline);

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
          font-family: 'Inter', sans-serif;
          box-shadow: 0 2px 8px rgba(16,185,129,0.4);
          border: 2px solid white;
        ">${idx + 1}</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });

      const labelMarker = L.marker([stop.lat, stop.lng], { icon: label, interactive: false });
      this.layers.labels.addLayer(labelMarker);
    });

    document.getElementById('optMapLegendOriginal').style.display = 'inline-flex';
    document.getElementById('optMapLegendOptimized').style.display = 'inline-flex';

    console.log('[OptimizeMap] Optimized route overlay applied');
  },

  invalidateSize() {
    if (this.map) {
      setTimeout(() => this.map.invalidateSize(), 150);
    }
  }
};