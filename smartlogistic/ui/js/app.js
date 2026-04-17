/* =========================================================
   app.js — Main Application Controller
   Navigation, event binding, dashboard logic & optimization
   ========================================================= */

(function () {
  'use strict';

  // ─── State ───
  let currentView = 'dashboard';
  let analyticsRendered = false;
  let mapInitialized = false;
  let optimizeMapInitialized = false;
  let selectedRouteId = null;
  let selectedRouteStops = [];

  // ─── View Titles ───
  const viewTitles = {
    dashboard: { title: 'Dashboard', breadcrumb: 'Real-time monitoring' },
    optimize: { title: 'Route Optimizer', breadcrumb: 'AI-powered delay prediction & stop reordering' },
    analytics: { title: 'Analytics', breadcrumb: 'Historical performance data' },
    routes: { title: 'All Routes', breadcrumb: 'Complete route database' }
  };

  // ─── Toast Notifications ───
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type]}</span>
      <span class="toast-message">${message}</span>
      <button class="toast-close" onclick="this.parentElement.classList.add('toast-removing'); setTimeout(() => this.parentElement.remove(), 300);">✕</button>
    `;
    container.appendChild(toast);

    // Auto remove after 4s
    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.add('toast-removing');
        setTimeout(() => toast.remove(), 300);
      }
    }, 4000);
  }

  // ─── Clock ───
  function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    document.getElementById('headerClock').textContent = timeStr;
  }

  // ─── Navigation ───
  function switchView(viewId) {
    if (currentView === viewId) return;
    currentView = viewId;

    // Update nav items
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewId);
    });

    // Update views
    document.querySelectorAll('.view').forEach(v => {
      v.classList.toggle('active', v.id === `view-${viewId}`);
    });

    // Update header
    const info = viewTitles[viewId] || { title: viewId, breadcrumb: '' };
    document.getElementById('pageTitle').textContent = info.title;
    document.getElementById('pageBreadcrumb').textContent = info.breadcrumb;

    // Lazy-init specific views
    if (viewId === 'dashboard' && mapInitialized) {
      MapManager.invalidateSize();
    }

    if (viewId === 'optimize') {
      initOptimizeMap();
    }

    if (viewId === 'analytics' && !analyticsRendered && DataStore.isLoaded) {
      Analytics.render(DataStore);
      analyticsRendered = true;
    }

    if (viewId === 'routes' && DataStore.isLoaded) {
      renderRoutesTable();
    }

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
  }

  // ─── Initialize Optimize Map (lazy) ───
  function initOptimizeMap() {
    if (!optimizeMapInitialized) {
      try {
        OptimizeMap.init();
        optimizeMapInitialized = true;
      } catch (e) {
        console.warn('[App] Optimize map init failed:', e);
      }
    } else {
      OptimizeMap.invalidateSize();
    }
  }

  // ─── Populate Route Selector ───
  function populateRouteSelector() {
    const select = document.getElementById('optRouteSelect');
    if (!select || !DataStore.isLoaded) return;

    // Keep the default option
    select.innerHTML = '<option value="">— Select a route —</option>';

    // Add routes sorted by delay (worst first)
    const routes = DataStore.getRoutesByDelay();
    routes.forEach(r => {
      const delay = r.total_delay_min || 0;
      const icon = delay > 60 ? '🔴' : delay > 20 ? '🟡' : '🟢';
      const opt = document.createElement('option');
      opt.value = r.route_id;
      opt.textContent = `${icon} ${r.route_id} — ${r.num_stops || 0} stops, ${delay.toFixed(0)} min delay, ${r.vehicle_type || 'unknown'}`;
      select.appendChild(opt);
    });
  }

  // ─── Handle Route Selection (show on map) ───
  function handleRouteSelect(routeId) {
    if (!routeId) {
      selectedRouteId = null;
      selectedRouteStops = [];
      document.getElementById('optMapStatus').textContent = 'Select a route';
      document.getElementById('stopDelayBody').innerHTML =
        '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">Select a route to see stops</td></tr>';
      document.getElementById('stopCount').textContent = '0 stops';
      document.getElementById('dispatcherAlerts').style.display = 'none';
      document.getElementById('resultPanel').classList.remove('visible');
      document.getElementById('recommendationCard').style.display = 'none';
      document.getElementById('optMapLegendOriginal').style.display = 'none';
      document.getElementById('optMapLegendOptimized').style.display = 'none';
      if (optimizeMapInitialized) OptimizeMap.clear();
      GraphManager.reset();
      return;
    }

    selectedRouteId = routeId;
    selectedRouteStops = DataStore.getStopCoordinates(routeId);

    // Get route info
    const routeInfo = DataStore.routes.find(r => r.route_id === routeId);

    // Auto-fill hidden fields for API
    if (routeInfo) {
      document.getElementById('totalDistanceKm').value = routeInfo.total_distance_km || 250;
      // Set vehicle type
      const vtSelect = document.getElementById('vehicleType');
      if (routeInfo.vehicle_type) {
        for (let i = 0; i < vtSelect.options.length; i++) {
          if (vtSelect.options[i].value === routeInfo.vehicle_type) {
            vtSelect.selectedIndex = i;
            break;
          }
        }
      }
    }

    // Show on map
    if (optimizeMapInitialized) {
      OptimizeMap.showRoute(selectedRouteStops, routeId);
    }

    // Update status
    document.getElementById('optMapStatus').textContent = `${routeId} — ${selectedRouteStops.length} stops`;
    document.getElementById('stopCount').textContent = `${selectedRouteStops.length} stops`;

    // Render stop-by-stop delay table
    renderStopDelayTable(selectedRouteStops);

    // Generate dispatcher alerts
    generateAlerts(selectedRouteStops, routeId, routeInfo);

    // Reset result panel
    document.getElementById('resultPanel').classList.remove('visible');
    document.getElementById('recommendationCard').style.display = 'none';
    document.getElementById('optMapLegendOriginal').style.display = 'none';
    document.getElementById('optMapLegendOptimized').style.display = 'none';
    GraphManager.reset();

    showToast(`Route ${routeId} loaded — ${selectedRouteStops.length} stops on map`, 'info');
  }

  // ─── Stop-by-Stop Delay Table ───
  function renderStopDelayTable(stops) {
    const tbody = document.getElementById('stopDelayBody');

    tbody.innerHTML = stops.map(s => {
      const delayBadge = s.delay > 15 ? 'badge-danger' : s.delay > 5 ? 'badge-warning' : 'badge-success';
      const probBadge = s.delayProb > 0.5 ? 'badge-danger' : s.delayProb > 0.25 ? 'badge-warning' : 'badge-success';
      const status = s.delay > 15 ? '⚠️ High' : s.delay > 5 ? '🟡 Med' : '✅ OK';
      const missWindow = s.missedWindow ? '❌ Missed' : '✅ In window';

      return `
        <tr>
          <td class="mono"><strong>${s.seq}</strong></td>
          <td style="font-size: 0.78rem;">${s.stopId}</td>
          <td style="font-size: 0.78rem;">${s.roadType}</td>
          <td><span class="badge ${delayBadge}">${s.delay.toFixed(1)} min</span></td>
          <td><span class="badge ${probBadge}">${(s.delayProb * 100).toFixed(0)}%</span></td>
          <td style="font-size: 0.72rem;">${missWindow}</td>
          <td style="font-size: 0.78rem;">${status}</td>
        </tr>
      `;
    }).join('');
  }

  // ─── Generate Dispatcher Alerts ───
  function generateAlerts(stops, routeId, routeInfo) {
    const alertsCard = document.getElementById('dispatcherAlerts');
    const alertsList = document.getElementById('alertsList');
    const alertCount = document.getElementById('alertCount');
    const alerts = [];

    // Check each stop for high delays
    stops.forEach(s => {
      if (s.delay > 15) {
        alerts.push({
          icon: '⚠️',
          text: `<strong>Delay ${s.delay.toFixed(1)} min</strong> at Stop #${s.seq} (${s.stopId}) — ${s.roadType} road, ${(s.delayProb * 100).toFixed(0)}% delay probability. Consider reordering this stop.`
        });
      }
    });

    // Check missed windows
    const missedStops = stops.filter(s => s.missedWindow);
    if (missedStops.length > 0) {
      alerts.push({
        icon: '❌',
        text: `<strong>${missedStops.length} stop(s) missed time window.</strong> Stops: ${missedStops.map(s => '#' + s.seq).join(', ')}. Recommend notifying customers.`
      });
    }

    // Check overall route delay
    const totalDelay = routeInfo ? (routeInfo.total_delay_min || 0) : 0;
    if (totalDelay > 100) {
      alerts.push({
        icon: '🚨',
        text: `<strong>Route ${routeId} has ${totalDelay.toFixed(0)} min total delay.</strong> This is critical — consider splitting the route or reassigning stops.`
      });
    }

    // Road condition warning
    const mountainStops = stops.filter(s => s.roadType === 'mountain');
    if (mountainStops.length > 2) {
      alerts.push({
        icon: '🏔️',
        text: `<strong>${mountainStops.length} stops on mountain roads.</strong> High delay risk in bad weather. Check weather conditions before dispatching.`
      });
    }

    if (alerts.length === 0) {
      alerts.push({ icon: '✅', text: 'No critical alerts for this route. All stops within acceptable parameters.' });
    }

    alertCount.textContent = `${alerts.length} alert${alerts.length !== 1 ? 's' : ''}`;

    alertsList.innerHTML = alerts.map(a => `
      <div class="alert-item">
        <span class="alert-icon">${a.icon}</span>
        <span class="alert-text">${a.text}</span>
      </div>
    `).join('');

    alertsCard.style.display = 'block';
  }

  // ─── Route Optimization (reorder stops by delay) ───
  function optimizeStopOrder(stops) {
    // Strategy: Move high-delay stops to the end, prioritize low-delay stops first
    // This minimizes cascading delays: deliver easy stops first, leave risky ones for last
    const sorted = [...stops].sort((a, b) => {
      // Primary: delay probability (lower first)
      const probDiff = a.delayProb - b.delayProb;
      if (Math.abs(probDiff) > 0.15) return probDiff;
      // Secondary: actual delay (lower first)
      return a.delay - b.delay;
    });

    // Re-number the stops
    return sorted.map((s, i) => ({ ...s, newSeq: i + 1, originalSeq: s.seq }));
  }

  // ─── Handle Optimize Button ───
  async function handleOptimize() {
    if (!selectedRouteId || selectedRouteStops.length === 0) {
      showToast('Please select a route first', 'warning');
      return;
    }

    const btn = document.getElementById('btnOptimize');
    const resultPanel = document.getElementById('resultPanel');
    const recCard = document.getElementById('recommendationCard');

    // Get route info for API
    const routeInfo = DataStore.routes.find(r => r.route_id === selectedRouteId);

    // Build payload for the backend API
    // --- 1. GERÇEK VERİLERİ ÇEK ---
    // CSV'den rotaya ait toplam paket sayısını alıyoruz
    const packageCount = DataStore.getTotalPackages(selectedRouteId);
    
    // Opsiyonel: Arayüzde personel sayısı inputu varsa al, yoksa 0 gönder (Backend Otonom Atayacak)
    const personnelInput = document.getElementById('personnelCount');
    const personnelCount = personnelInput ? parseInt(personnelInput.value) : 0;

    // --- 2. PYTHON (FASTAPI) PAYLOAD'UNU OLUŞTUR ---
    // Backend'deki IncidentPayload Pydantic sınıfı ile birebir aynı key'leri kullanıyoruz.
    const payload = {
      event_id: `EVT-${selectedRouteId}`,
      affected_edge: document.getElementById('affectedEdge').value,
      weather_condition: document.getElementById('weatherCondition').value,
      traffic_level: document.getElementById('trafficLevel').value,
      vehicle_type: document.getElementById('vehicleType').value,
      temperature_c: parseFloat(document.getElementById('temperatureC').value) || 5.0,
      total_distance_km: parseFloat(document.getElementById('totalDistanceKm').value) || 250.0,
      
      // YAPAY ZEKA ARTIK KÖR DEĞİL: Sadece ID değil, Haversine matrisi için GPS verilerini de yolluyoruz
      stops_to_visit: selectedRouteStops.map(s => ({
          id: s.stopId,
          lat: s.lat,
          lng: s.lng
      })),
      
      package_count: packageCount,
      personnel_count: personnelCount
    };

    // Loading state
    btn.classList.add('loading');
    btn.innerHTML = '&nbsp; Analyzing...';

    try {
      // 1. Backend'deki Otonom CEO'yu (API) Çağır
      const apiResult = await API.optimizeRoute(payload);

      if (apiResult && apiResult.status === 'success') {
          
        // --- 2. YAPAY ZEKANIN (BACKEND) GERÇEK ROTASINI UYGULA ---
        // Backend'den gelen ID sıralamasını (Örn: STP-4 -> STP-1 -> STP-3) al
        const aiRouteIds = apiResult.tactical_decision.new_route;
        
        // Durak objelerimizi AI'nın verdiği bu kusursuz sıraya göre diz
        const optimizedStops = aiRouteIds.map((id, index) => {
            const stop = selectedRouteStops.find(s => s.stopId === id);
            if(stop) {
                return { ...stop, newSeq: index + 1, originalSeq: stop.seq };
            }
            return null;
        }).filter(s => s !== null);

        // --- 3. FİNANSAL VERİLERİ BACKEND'DEN ÇEK (Uydurma rakamlar değil!) ---
        // Orijinal durumu hesapla (Kıyaslama yapabilmek için)
        const originalTime = selectedRouteStops.reduce((sum, s) => sum + s.delay, 0) + (routeInfo.planned_duration_min || 0);
        const originalCost = originalTime * 6.5; // Manuel yönetimin tahmini maliyeti

        // Optimize durumu Backend'den (Opet + Maaş hesaplanmış haliyle) al
        const optimizedTime = apiResult.tactical_decision.total_estimated_time_minutes;
        const optimizedCost = apiResult.financial_impact.total_op_cost;
        const savings = apiResult.financial_impact.fuel_savings;

        // --- 4. ARAYÜZÜ (UI) GÜNCELLE ---
        // Tabloları doldur
        document.getElementById('beforeCost').innerText = `₺${originalCost.toFixed(0)}`;
        document.getElementById('beforeTime').innerText = `${originalTime.toFixed(0)} min`;
        document.getElementById('afterCost').innerText = `₺${optimizedCost.toFixed(0)}`;
        document.getElementById('afterTime').innerText = `${optimizedTime.toFixed(0)} min`;

        const gain = (((originalCost - optimizedCost) / originalCost) * 100).toFixed(1);
        document.getElementById('efficiencyGain').innerText = `%${gain}`;
        document.getElementById('moneySaved').innerText = `₺${savings} Saved`;

        // ML Sonuç Paneli
        const header = document.getElementById('resultHeader');
        header.className = 'result-header success';
        header.querySelector('h3').textContent = '✅ Optimization Complete';
        document.getElementById('resultStatus').textContent = 'Success';
        document.getElementById('resultStatus').className = 'badge badge-success';

        document.getElementById('resDelay').textContent = `+${apiResult.ml_predicted_delay_minutes || 0} min (XGBoost)`;
        document.getElementById('resAnalysis').textContent = apiResult.analysis; // Araç atama nedeni buraya gelecek
        document.getElementById('resNewRoute').textContent = aiRouteIds.join(' → ');
        document.getElementById('resTotalTime').textContent = `${optimizedTime.toFixed(0)} min`;

        // Finansal Açıklama Kartı (XAI)
        const fAlert = document.getElementById('financialAlert');
        const sDesc = document.getElementById('savingsDescription');
        if (fAlert) {
            fAlert.style.display = 'block';
            sDesc.innerText = `FlowStation AI: ${apiResult.analysis} Bu operasyonel hamle ile toplam ₺${savings} tasarruf sağlandı.`;
        }

        resultPanel.classList.add('visible');

        // --- 5. HARİTAYI ÇİZ (Gerçek AI Rotası) ---
        if (optimizeMapInitialized) {
            OptimizeMap.showOptimizedRoute(selectedRouteStops, optimizedStops);
        }

        // --- 6. DURAK TABLOSUNU GÜNCELLE ---
        renderOptimizedStopTable(optimizedStops);

        showToast('Kâr odaklı optimizasyon tamamlandı!', 'success');
      }

    } catch (err) {
      console.error('[Optimize] Error:', err);
      const header = document.getElementById('resultHeader');
      header.className = 'result-header danger';
      header.querySelector('h3').textContent = '❌ Optimization Failed';
      document.getElementById('resultStatus').textContent = 'Error';
      document.getElementById('resultStatus').className = 'badge badge-danger';
      document.getElementById('resAnalysis').textContent = err.message;
      resultPanel.classList.add('visible');
      showToast(`Optimization failed: ${err.message}`, 'error');
    } finally {
      btn.classList.remove('loading');
      btn.innerHTML = '🧠 Analyze & Optimize';
    }
  }
  // ─── Render optimized stop table (shows old vs new order) ───
  function renderOptimizedStopTable(optimizedStops) {
    const tbody = document.getElementById('stopDelayBody');

    tbody.innerHTML = optimizedStops.map((s, i) => {
      const delayBadge = s.delay > 15 ? 'badge-danger' : s.delay > 5 ? 'badge-warning' : 'badge-success';
      const probBadge = s.delayProb > 0.5 ? 'badge-danger' : s.delayProb > 0.25 ? 'badge-warning' : 'badge-success';
      const moved = s.originalSeq !== s.newSeq;
      const movedBadge = moved ? `<span style="color: var(--success); font-size: 0.7rem;">(was #${s.originalSeq})</span>` : '';
      const status = moved ? '🔄 Moved' : '✅ OK';

      return `
        <tr style="${moved ? 'background: rgba(16, 185, 129, 0.04);' : ''}">
          <td class="mono"><strong>${s.newSeq}</strong> ${movedBadge}</td>
          <td style="font-size: 0.78rem;">${s.stopId}</td>
          <td style="font-size: 0.78rem;">${s.roadType}</td>
          <td><span class="badge ${delayBadge}">${s.delay.toFixed(1)} min</span></td>
          <td><span class="badge ${probBadge}">${(s.delayProb * 100).toFixed(0)}%</span></td>
          <td style="font-size: 0.72rem;">—</td>
          <td style="font-size: 0.78rem;">${status}</td>
        </tr>
      `;
    }).join('');
  }

  // ─── Dashboard KPIs ───
  function updateKPIs() {
    const kpis = DataStore.getKPIs();
    document.getElementById('kpiActiveRoutes').textContent = kpis.activeRoutes;
    document.getElementById('kpiAvgDelay').textContent = `${kpis.avgDelay} min`;
    document.getElementById('kpiOnTime').textContent = kpis.onTimeRate;
    document.getElementById('kpiDelayed').textContent = kpis.delayedRoutes;
  }

  // ─── Route List ───
  function renderRouteList() {
    const list = document.getElementById('routeList');
    const routes = DataStore.getRoutesByDelay().slice(0, 20);

    list.innerHTML = routes.map(r => {
      const delay = r.total_delay_min || 0;
      const status = delay > 60 ? 'critical' : delay > 20 ? 'delayed' : 'on-time';
      const delayColor = status === 'critical' ? 'var(--danger)' : status === 'delayed' ? 'var(--warning)' : 'var(--success)';

      return `
        <div class="route-item" data-route="${r.route_id}" onclick="window.appHighlightRoute('${r.route_id}')">
          <span class="route-status ${status}"></span>
          <div class="route-info">
            <div class="route-id">${r.route_id}</div>
            <div class="route-meta">${r.vehicle_type || '—'} • ${r.num_stops || 0} stops • ${(r.total_distance_km || 0).toFixed(0)} km</div>
          </div>
          <div class="route-delay" style="color: ${delayColor};">
            ${delay > 0 ? '+' : ''}${delay.toFixed(0)} min
          </div>
        </div>
      `;
    }).join('');
  }

  // Make highlight function globally accessible
  window.appHighlightRoute = function (routeId) {
    if (mapInitialized) {
      MapManager.highlightRoute(routeId, DataStore);
      showToast(`Showing route ${routeId} on map`, 'info');
    }
  };

  // ─── Weather Widget ───
  function updateWeatherWidget() {
    if (!DataStore.weatherData.length) return;

    // Pick the latest weather observation
    const lastWeather = DataStore.weatherData[DataStore.weatherData.length - 1];
    const temp = lastWeather.temperature_c || 0;
    const condition = lastWeather.weather_condition || 'clear';

    const weatherIcons = {
      'clear': '☀️', 'cloudy': '☁️', 'rain': '🌧️',
      'snow': '❄️', 'fog': '🌫️', 'wind': '💨'
    };

    const widget = document.getElementById('weatherWidget');
    widget.innerHTML = `
      <div class="weather-icon">${weatherIcons[condition] || '🌡️'}</div>
      <div class="weather-details">
        <h4>${temp.toFixed(1)}°C</h4>
        <span>${condition.charAt(0).toUpperCase() + condition.slice(1)} — Wind ${(lastWeather.wind_speed_kmh || 0).toFixed(0)} km/h — Humidity ${(lastWeather.humidity_pct || 0).toFixed(0)}%</span>
      </div>
    `;
  }

  // ─── Routes Table ───
  function renderRoutesTable() {
    const tbody = document.getElementById('routesTableBody');
    const routes = DataStore.routes;

    document.getElementById('routeCountBadge').textContent = `${routes.length} routes`;

    tbody.innerHTML = routes.map(r => {
      const delay = r.total_delay_min || 0;
      const delayBadge = delay > 60 ? 'badge-danger' :
        delay > 20 ? 'badge-warning' : 'badge-success';
      const onTimeRate = ((r.on_time_delivery_rate || 0) * 100).toFixed(0);

      return `
        <tr>
          <td><strong>${r.route_id}</strong></td>
          <td>${r.vehicle_type || '—'}</td>
          <td class="mono">${r.num_stops || 0}</td>
          <td class="mono">${(r.total_distance_km || 0).toFixed(1)} km</td>
          <td class="mono">${(r.planned_duration_min || 0).toFixed(0)} min</td>
          <td class="mono">${(r.actual_duration_min || 0).toFixed(0)} min</td>
          <td><span class="badge ${delayBadge}">${delay.toFixed(1)} min</span></td>
          <td>${r.weather_condition || '—'}</td>
          <td>${r.traffic_level || '—'}</td>
          <td class="mono">${onTimeRate}%</td>
        </tr>
      `;
    }).join('');
  }

  // ─── Sort Routes Toggle ───
  let sortAsc = false;
  function toggleSortRoutes() {
    sortAsc = !sortAsc;
    const routes = DataStore.getRoutesByDelay();
    if (sortAsc) routes.reverse();
    const list = document.getElementById('routeList');
    list.innerHTML = routes.slice(0, 20).map(r => {
      const delay = r.total_delay_min || 0;
      const status = delay > 60 ? 'critical' : delay > 20 ? 'delayed' : 'on-time';
      const delayColor = status === 'critical' ? 'var(--danger)' : status === 'delayed' ? 'var(--warning)' : 'var(--success)';
      return `
        <div class="route-item" data-route="${r.route_id}" onclick="window.appHighlightRoute('${r.route_id}')">
          <span class="route-status ${status}"></span>
          <div class="route-info">
            <div class="route-id">${r.route_id}</div>
            <div class="route-meta">${r.vehicle_type || '—'} • ${r.num_stops || 0} stops • ${(r.total_distance_km || 0).toFixed(0)} km</div>
          </div>
          <div class="route-delay" style="color: ${delayColor};">
            ${delay > 0 ? '+' : ''}${delay.toFixed(0)} min
          </div>
        </div>
      `;
    }).join('');
  }

  // ─── Initialization ───
  async function init() {
    console.log('[App] Smart Logistics Dashboard starting...');

    // Clock
    updateClock();
    setInterval(updateClock, 1000);

    // Navigation
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Mobile menu
    document.getElementById('mobileMenuBtn').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });

    // Optimize button
    document.getElementById('btnOptimize').addEventListener('click', handleOptimize);

    // Route selector change
    document.getElementById('optRouteSelect').addEventListener('change', (e) => {
      handleRouteSelect(e.target.value);
    });

    // Sort button
    document.getElementById('btnSortRoutes').addEventListener('click', toggleSortRoutes);

    // Refresh button
    document.getElementById('btnRefresh').addEventListener('click', async () => {
      showToast('Refreshing data...', 'info');
      await loadData();
    });

    // Init dashboard map
    try {
      MapManager.init();
      mapInitialized = true;
    } catch (e) {
      console.warn('[App] Map initialization failed:', e);
    }

    // Load data
    await loadData();

    // Health check
    const backendOnline = await API.healthCheck();
    if (backendOnline) {
      showToast('Backend API connected', 'success');
    } else {
      showToast('Backend offline — using frontend-only optimization', 'warning');
    }

    console.log('[App] Dashboard ready!');
  }

  async function loadData() {
    try {
      const counts = await DataStore.init();
      showToast(`Loaded ${counts.routes} routes, ${counts.stops} stops`, 'success');

      // Update dashboard
      updateKPIs();
      renderRouteList();
      updateWeatherWidget();

      // Plot routes on map
      if (mapInitialized) {
        MapManager.plotAllRoutes(DataStore, 15);
      }

      // Populate route selector for optimizer
      populateRouteSelector();

      // If analytics was already shown, re-render
      if (analyticsRendered) {
        Analytics.render(DataStore);
      }
    } catch (err) {
      console.error('[App] Data loading failed:', err);
      showToast('Failed to load data — check file paths', 'error');
    }
  }

  // Start
// Start
  document.addEventListener('DOMContentLoaded', init);
})();