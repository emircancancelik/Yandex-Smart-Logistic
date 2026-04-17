/* =========================================================
   app.js — Main Application Controller
   ========================================================= */
(function () {
  'use strict';

  let currentView = 'optimize';
  let analyticsRendered = false;
  let mapInitialized = false;
  let optimizeMapInitialized = false;
  let selectedRouteId = null;
  let selectedRouteStops = [];
  let liveFuelPrices = null;

  // ─── Voice Recognition ───
  let voiceRecognition = null;
  let voiceActive = false;

  function initVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[Voice] Speech Recognition not supported in this browser.');
      const micBtn = document.getElementById('btnMic');
      if (micBtn) { micBtn.disabled = true; micBtn.title = 'Voice not supported in this browser'; }
      return;
    }

    voiceRecognition = new SpeechRecognition();
    voiceRecognition.continuous = true;
    voiceRecognition.interimResults = true;
    voiceRecognition.lang = 'en-US';

    voiceRecognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.toLowerCase().trim();
        if (transcript.includes('calculate')) {
          showToast('🎤 Voice command: Calculate — running optimization...', 'info');
          handleOptimize();
          voiceRecognition.stop();
          voiceActive = false;
          updateMicButton(false);
          break;
        }
      }
    };

    voiceRecognition.onerror = (e) => {
      console.warn('[Voice] Error:', e.error);
      voiceActive = false;
      updateMicButton(false);
    };

    voiceRecognition.onend = () => {
      if (voiceActive) voiceRecognition.start(); // keep listening
    };
  }

  function toggleVoice() {
    if (!voiceRecognition) return;
    if (voiceActive) {
      voiceRecognition.stop();
      voiceActive = false;
    } else {
      voiceRecognition.start();
      voiceActive = true;
      showToast('🎤 Listening... say "calculate" to optimize the route', 'info');
    }
    updateMicButton(voiceActive);
  }

  function updateMicButton(active) {
    const btn = document.getElementById('btnMic');
    if (!btn) return;
    if (active) {
      btn.classList.add('mic-active');
      btn.innerHTML = '🔴 Listening...';
    } else {
      btn.classList.remove('mic-active');
      btn.innerHTML = '🎤 Voice';
    }
  }

  // ─── Toast ───
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span class="toast-message">${message}</span><button class="toast-close" onclick="this.parentElement.classList.add('toast-removing');setTimeout(()=>this.parentElement.remove(),300)">✕</button>`;
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentElement) { toast.classList.add('toast-removing'); setTimeout(() => toast.remove(), 300); } }, 4500);
  }

  // ─── Clock ───
  function updateClock() {
    const now = new Date();
    document.getElementById('headerClock').textContent = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // ─── Navigation ───
  const viewTitles = {
    dashboard: { title: 'Dashboard', breadcrumb: 'Real-time monitoring' },
    optimize:  { title: 'Route Optimizer', breadcrumb: 'AI-powered delay prediction & stop reordering' },
    analytics: { title: 'Analytics', breadcrumb: 'Historical performance data' },
    routes:    { title: 'All Routes', breadcrumb: 'Complete route database' }
  };

  function switchView(viewId) {
    if (currentView === viewId) return;
    currentView = viewId;
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.view === viewId));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${viewId}`));
    const info = viewTitles[viewId] || { title: viewId, breadcrumb: '' };
    document.getElementById('pageTitle').textContent = info.title;
    document.getElementById('pageBreadcrumb').textContent = info.breadcrumb;
    if (viewId === 'dashboard' && mapInitialized) MapManager.invalidateSize();
    if (viewId === 'optimize') initOptimizeMap();
    if (viewId === 'analytics' && !analyticsRendered && DataStore.isLoaded) { Analytics.render(DataStore); analyticsRendered = true; }
    if (viewId === 'routes' && DataStore.isLoaded) renderRoutesTable();
    document.getElementById('sidebar').classList.remove('open');
  }

  function initOptimizeMap() {
    if (!optimizeMapInitialized) {
      try { OptimizeMap.init(); optimizeMapInitialized = true; }
      catch (e) { console.warn('[App] Optimize map init failed:', e); }
    } else {
      OptimizeMap.invalidateSize();
    }
  }

  // ─── Fuel Prices ───
  async function loadFuelPrices() {
    try {
      let lat = null, lng = null;
      if (navigator.geolocation) {
        try {
          const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
          });
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        } catch (geoErr) {
          console.warn('[Fuel] Geolocation failed or denied:', geoErr.message);
        }
      }
      
      const url = new URL(`${API.BASE_URL}/api/v1/fuel-prices`);
      if (lat && lng) {
        url.searchParams.append('lat', lat);
        url.searchParams.append('lng', lng);
      }
      
      const res = await fetch(url);
      if (!res.ok) throw new Error('Fuel price endpoint unavailable');
      liveFuelPrices = await res.json();
      renderFuelPricesWidget(liveFuelPrices);
    } catch (e) {
      console.warn('[Fuel] Could not load live prices:', e.message);
      liveFuelPrices = { gasoline_tl_per_liter: 64.49, diesel_tl_per_liter: 73.52, lpg_tl_per_liter: 16.80, source: 'fallback' };
      renderFuelPricesWidget(liveFuelPrices);
    }
  }

  function renderFuelPricesWidget(prices) {
    const el = document.getElementById('fuelPricesBar');
    if (!el || !prices) return;
    const src = prices.source === 'opet_api_live' ? '🟢 Live' : '⚡ Cached';
    el.innerHTML = `
      <div class="fuel-price-item"><span class="fuel-icon">⛽</span><span class="fuel-label">Gasoline</span><span class="fuel-value">₺${prices.gasoline_tl_per_liter.toFixed(2)}/L</span></div>
      <div class="fuel-price-item"><span class="fuel-icon">🛢️</span><span class="fuel-label">Diesel</span><span class="fuel-value">₺${prices.diesel_tl_per_liter.toFixed(2)}/L</span></div>
      <div class="fuel-price-item"><span class="fuel-icon">🔵</span><span class="fuel-label">LPG</span><span class="fuel-value">₺${prices.lpg_tl_per_liter.toFixed(2)}/L</span></div>
      <div class="fuel-source">${src} Opet Prices</div>`;
  }

  // ─── Route Selector ───
  function populateRouteSelector() {
    const select = document.getElementById('optRouteSelect');
    if (!select || !DataStore.isLoaded) return;
    select.innerHTML = '<option value="">— Select a route —</option>';
    DataStore.getRoutesByDelay().forEach(r => {
      const delay = r.total_delay_min || 0;
      const icon = delay > 60 ? '🔴' : delay > 20 ? '🟡' : '🟢';
      const opt = document.createElement('option');
      opt.value = r.route_id;
      opt.textContent = `${icon} ${r.route_id} — ${r.num_stops || 0} stops, ${delay.toFixed(0)} min delay, ${r.vehicle_type || 'unknown'}`;
      select.appendChild(opt);
    });
  }

  function handleRouteSelect(routeId) {
    if (!routeId) {
      selectedRouteId = null; selectedRouteStops = [];
      document.getElementById('optMapStatus').textContent = 'Select a route';
      document.getElementById('stopDelayBody').innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;">Select a route to see stops</td></tr>';
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
    const routeInfo = DataStore.routes.find(r => r.route_id === routeId);
    if (routeInfo) {
      document.getElementById('totalDistanceKm').value = routeInfo.total_distance_km || 250;
      const vtSelect = document.getElementById('vehicleType');
      if (routeInfo.vehicle_type) {
        for (let i = 0; i < vtSelect.options.length; i++) {
          if (vtSelect.options[i].value === routeInfo.vehicle_type) { vtSelect.selectedIndex = i; break; }
        }
      }
      if (routeInfo.weather_condition) {
        const wcSelect = document.getElementById('weatherCondition');
        if (wcSelect) {
          for (let i = 0; i < wcSelect.options.length; i++) {
            if (wcSelect.options[i].value === routeInfo.weather_condition) { wcSelect.selectedIndex = i; break; }
          }
        }
      }
      if (routeInfo.traffic_level) {
        const tlSelect = document.getElementById('trafficLevel');
        if (tlSelect) {
          for (let i = 0; i < tlSelect.options.length; i++) {
            if (tlSelect.options[i].value === routeInfo.traffic_level) { tlSelect.selectedIndex = i; break; }
          }
        }
      }
      if (routeInfo.temperature_c !== undefined) {
        const tempInput = document.getElementById('temperatureC');
        if (tempInput) {
          tempInput.value = routeInfo.temperature_c;
        }
      }
    }
    if (optimizeMapInitialized) OptimizeMap.showRoute(selectedRouteStops, routeId);
    document.getElementById('optMapStatus').textContent = `${routeId} — ${selectedRouteStops.length} stops`;
    document.getElementById('stopCount').textContent = `${selectedRouteStops.length} stops`;
    renderStopDelayTable(selectedRouteStops);
    generateAlerts(selectedRouteStops, routeId, routeInfo);
    document.getElementById('resultPanel').classList.remove('visible');
    document.getElementById('recommendationCard').style.display = 'none';
    document.getElementById('optMapLegendOriginal').style.display = 'none';
    document.getElementById('optMapLegendOptimized').style.display = 'none';
    GraphManager.reset();
    showToast(`Route ${routeId} loaded — ${selectedRouteStops.length} stops on map`, 'info');
  }

  function renderStopDelayTable(stops) {
    const tbody = document.getElementById('stopDelayBody');
    tbody.innerHTML = stops.map(s => {
      const dB = s.delay > 15 ? 'badge-danger' : s.delay > 5 ? 'badge-warning' : 'badge-success';
      const pB = s.delayProb > 0.5 ? 'badge-danger' : s.delayProb > 0.25 ? 'badge-warning' : 'badge-success';
      const status = s.delay > 15 ? '⚠️ High' : s.delay > 5 ? '🟡 Med' : '✅ OK';
      const mw = s.missedWindow ? '❌ Missed' : '✅ In window';
      return `<tr><td class="mono"><strong>${s.seq}</strong></td><td style="font-size:.78rem;">${s.stopId}</td><td style="font-size:.78rem;">${s.roadType}</td><td><span class="badge ${dB}">${s.delay.toFixed(1)} min</span></td><td><span class="badge ${pB}">${(s.delayProb*100).toFixed(0)}%</span></td><td style="font-size:.72rem;">${mw}</td><td style="font-size:.78rem;">${status}</td></tr>`;
    }).join('');
  }

  function generateAlerts(stops, routeId, routeInfo) {
    const alertsCard = document.getElementById('dispatcherAlerts');
    const alertsList = document.getElementById('alertsList');
    const alertCount = document.getElementById('alertCount');
    const alerts = [];
    stops.forEach(s => {
      if (s.delay > 15) alerts.push({ icon: '⚠️', text: `<strong>Delay ${s.delay.toFixed(1)} min</strong> at Stop #${s.seq} (${s.stopId}) — ${s.roadType} road, ${(s.delayProb*100).toFixed(0)}% delay probability.` });
    });
    const missed = stops.filter(s => s.missedWindow);
    if (missed.length > 0) alerts.push({ icon: '❌', text: `<strong>${missed.length} stop(s) missed time window.</strong> Stops: ${missed.map(s => '#' + s.seq).join(', ')}. Recommend notifying customers.` });
    const totalDelay = routeInfo ? (routeInfo.total_delay_min || 0) : 0;
    if (totalDelay > 100) alerts.push({ icon: '🚨', text: `<strong>Route ${routeId} has ${totalDelay.toFixed(0)} min total delay.</strong> Consider splitting route or reassigning stops.` });
    const mountain = stops.filter(s => s.roadType === 'mountain');
    if (mountain.length > 2) alerts.push({ icon: '🏔️', text: `<strong>${mountain.length} stops on mountain roads.</strong> High delay risk in bad weather.` });
    if (alerts.length === 0) alerts.push({ icon: '✅', text: 'No critical alerts for this route. All stops within acceptable parameters.' });
    alertCount.textContent = `${alerts.length} alert${alerts.length !== 1 ? 's' : ''}`;
    alertsList.innerHTML = alerts.map(a => `<div class="alert-item"><span class="alert-icon">${a.icon}</span><span class="alert-text">${a.text}</span></div>`).join('');
    alertsCard.style.display = 'block';
  }

  // ─── Optimize ───
  async function handleOptimize() {
    if (!selectedRouteId || selectedRouteStops.length === 0) {
      showToast('Please select a route first', 'warning');
      return;
    }
    const btn = document.getElementById('btnOptimize');
    const resultPanel = document.getElementById('resultPanel');
    const routeInfo = DataStore.routes.find(r => r.route_id === selectedRouteId);
    const packageCount = DataStore.getTotalPackages(selectedRouteId);
    const personnelInput = document.getElementById('personnelCount');
    const personnelCount = personnelInput ? parseInt(personnelInput.value) : 0;

    const payload = {
      event_id: `EVT-${selectedRouteId}`,
      affected_edge: document.getElementById('affectedEdge').value,
      weather_condition: document.getElementById('weatherCondition').value,
      traffic_level: document.getElementById('trafficLevel').value,
      vehicle_type: document.getElementById('vehicleType').value,
      temperature_c: parseFloat(document.getElementById('temperatureC').value) || 5.0,
      total_distance_km: parseFloat(document.getElementById('totalDistanceKm').value) || 250.0,
      stops_to_visit: selectedRouteStops.map(s => ({ id: s.stopId, lat: s.lat, lng: s.lng })),
      package_count: packageCount,
      personnel_count: personnelCount
    };

    btn.classList.add('loading');
    btn.innerHTML = '⏳ Analyzing...';

    try {
      const apiResult = await API.optimizeRoute(payload);
      if (apiResult && apiResult.status === 'success') {
        const aiRouteIds = apiResult.tactical_decision.new_route;
        const optimizedStops = aiRouteIds.map((id, index) => {
          const stop = selectedRouteStops.find(s => s.stopId === id);
          return stop ? { ...stop, newSeq: index + 1, originalSeq: stop.seq } : null;
        }).filter(Boolean);

        const originalTime = selectedRouteStops.reduce((s, st) => s + st.delay, 0) + (routeInfo.planned_duration_min || 0);
        const originalCost = originalTime * 6.5;
        const optimizedTime = apiResult.tactical_decision.total_estimated_time_minutes;
        const optimizedCost = apiResult.financial_impact.total_op_cost;
        const savings = apiResult.financial_impact.fuel_savings;

        document.getElementById('beforeCost').innerText = `₺${originalCost.toFixed(0)}`;
        document.getElementById('beforeTime').innerText = `${originalTime.toFixed(0)} min`;
        document.getElementById('afterCost').innerText  = `₺${optimizedCost.toFixed(0)}`;
        document.getElementById('afterTime').innerText  = `${optimizedTime.toFixed(0)} min`;

        const gain = (((originalCost - optimizedCost) / originalCost) * 100).toFixed(1);
        document.getElementById('efficiencyGain').innerText = `${gain}%`;
        document.getElementById('moneySaved').innerText = `₺${savings} Saved`;

        const header = document.getElementById('resultHeader');
        header.className = 'result-header success';
        header.querySelector('h3').textContent = '✅ Optimization Complete';
        document.getElementById('resultStatus').textContent = 'Success';
        document.getElementById('resultStatus').className = 'badge badge-success';
        document.getElementById('resDelay').textContent = `+${apiResult.ml_predicted_delay_minutes || 0} min (XGBoost)`;
        document.getElementById('resAnalysis').textContent = apiResult.analysis;
        document.getElementById('resNewRoute').textContent = aiRouteIds.join(' → ');
        document.getElementById('resTotalTime').textContent = `${optimizedTime.toFixed(0)} min`;

        const fAlert = document.getElementById('financialAlert');
        const sDesc  = document.getElementById('savingsDescription');
        if (fAlert) {
          fAlert.style.display = 'block';
          sDesc.innerText = `FlowStation AI: ${apiResult.analysis} Total savings: ₺${savings}.`;
        }

        resultPanel.classList.add('visible');
        if (optimizeMapInitialized) OptimizeMap.showOptimizedRoute(selectedRouteStops, optimizedStops);
        renderOptimizedStopTable(optimizedStops);
        showToast('Route optimization complete!', 'success');
      }
    } catch (err) {
      console.error('[Optimize] Error:', err);
      const header = document.getElementById('resultHeader');
      header.className = 'result-header danger';
      header.querySelector('h3').textContent = '❌ Optimization Failed';
      document.getElementById('resAnalysis').textContent = err.message;
      resultPanel.classList.add('visible');
      showToast(`Optimization failed: ${err.message}`, 'error');
    } finally {
      btn.classList.remove('loading');
      btn.innerHTML = '🧠 Analyze & Optimize';
    }
  }

  function renderOptimizedStopTable(optimizedStops) {
    const tbody = document.getElementById('stopDelayBody');
    tbody.innerHTML = optimizedStops.map(s => {
      const dB = s.delay > 15 ? 'badge-danger' : s.delay > 5 ? 'badge-warning' : 'badge-success';
      const pB = s.delayProb > 0.5 ? 'badge-danger' : s.delayProb > 0.25 ? 'badge-warning' : 'badge-success';
      const moved = s.originalSeq !== s.newSeq;
      const movedBadge = moved ? `<span style="color:var(--success);font-size:.7rem;">(was #${s.originalSeq})</span>` : '';
      const status = moved ? '🔄 Moved' : '✅ OK';
      return `<tr style="${moved ? 'background:rgba(16,185,129,0.04);' : ''}"><td class="mono"><strong>${s.newSeq}</strong> ${movedBadge}</td><td style="font-size:.78rem;">${s.stopId}</td><td style="font-size:.78rem;">${s.roadType}</td><td><span class="badge ${dB}">${s.delay.toFixed(1)} min</span></td><td><span class="badge ${pB}">${(s.delayProb*100).toFixed(0)}%</span></td><td style="font-size:.72rem;">—</td><td style="font-size:.78rem;">${status}</td></tr>`;
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

  function renderRouteList() {
    const list = document.getElementById('routeList');
    const routes = DataStore.getRoutesByDelay().slice(0, 20);
    list.innerHTML = routes.map(r => {
      const delay = r.total_delay_min || 0;
      const status = delay > 60 ? 'critical' : delay > 20 ? 'delayed' : 'on-time';
      const delayColor = status === 'critical' ? 'var(--danger)' : status === 'delayed' ? 'var(--warning)' : 'var(--success)';
      return `<div class="route-item" data-route="${r.route_id}" onclick="window.appHighlightRoute('${r.route_id}')"><span class="route-status ${status}"></span><div class="route-info"><div class="route-id">${r.route_id}</div><div class="route-meta">${r.vehicle_type || '—'} • ${r.num_stops || 0} stops • ${(r.total_distance_km || 0).toFixed(0)} km</div></div><div class="route-delay" style="color:${delayColor};">${delay > 0 ? '+' : ''}${delay.toFixed(0)} min</div></div>`;
    }).join('');
  }

  window.appHighlightRoute = function (routeId) {
    if (mapInitialized) { MapManager.highlightRoute(routeId, DataStore); showToast(`Showing route ${routeId} on map`, 'info'); }
  };

  function updateWeatherWidget() {
    if (!DataStore.weatherData.length) return;
    const w = DataStore.weatherData[DataStore.weatherData.length - 1];
    const temp = w.temperature_c || 0;
    const condition = w.weather_condition || 'clear';
    const icons = { 'clear': '☀️', 'cloudy': '☁️', 'rain': '🌧️', 'snow': '❄️', 'fog': '🌫️', 'wind': '💨' };
    document.getElementById('weatherWidget').innerHTML = `<div class="weather-icon">${icons[condition] || '🌡️'}</div><div class="weather-details"><h4>${temp.toFixed(1)}°C</h4><span>${condition.charAt(0).toUpperCase() + condition.slice(1)} — Wind ${(w.wind_speed_kmh || 0).toFixed(0)} km/h — Humidity ${(w.humidity_pct || 0).toFixed(0)}%</span></div>`;
  }

  function renderRoutesTable() {
    const tbody = document.getElementById('routesTableBody');
    const routes = DataStore.routes;
    document.getElementById('routeCountBadge').textContent = `${routes.length} routes`;
    tbody.innerHTML = routes.map(r => {
      const delay = r.total_delay_min || 0;
      const dB = delay > 60 ? 'badge-danger' : delay > 20 ? 'badge-warning' : 'badge-success';
      const onTime = ((r.on_time_delivery_rate || 0) * 100).toFixed(0);
      return `<tr><td><strong>${r.route_id}</strong></td><td>${r.vehicle_type || '—'}</td><td class="mono">${r.num_stops || 0}</td><td class="mono">${(r.total_distance_km || 0).toFixed(1)} km</td><td class="mono">${(r.planned_duration_min || 0).toFixed(0)} min</td><td class="mono">${(r.actual_duration_min || 0).toFixed(0)} min</td><td><span class="badge ${dB}">${delay.toFixed(1)} min</span></td><td>${r.weather_condition || '—'}</td><td>${r.traffic_level || '—'}</td><td class="mono">${onTime}%</td></tr>`;
    }).join('');
  }

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
      return `<div class="route-item" data-route="${r.route_id}" onclick="window.appHighlightRoute('${r.route_id}')"><span class="route-status ${status}"></span><div class="route-info"><div class="route-id">${r.route_id}</div><div class="route-meta">${r.vehicle_type || '—'} • ${r.num_stops || 0} stops • ${(r.total_distance_km || 0).toFixed(0)} km</div></div><div class="route-delay" style="color:${delayColor};">${delay > 0 ? '+' : ''}${delay.toFixed(0)} min</div></div>`;
    }).join('');
  }

  // ─── Init ───
  async function init() {
    console.log('[App] Smart Logistics Dashboard starting...');

    updateClock();
    setInterval(updateClock, 1000);

    document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
    document.getElementById('mobileMenuBtn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
    document.getElementById('btnOptimize').addEventListener('click', handleOptimize);
    document.getElementById('btnMic').addEventListener('click', toggleVoice);
    document.getElementById('optRouteSelect').addEventListener('change', e => handleRouteSelect(e.target.value));
    document.getElementById('btnSortRoutes').addEventListener('click', toggleSortRoutes);
    document.getElementById('btnRefresh').addEventListener('click', async () => { showToast('Refreshing data...', 'info'); await loadData(); });

    try { MapManager.init(); mapInitialized = true; } catch (e) { console.warn('[App] Map init failed:', e); }

    await loadData();
    await loadFuelPrices();

    initVoiceRecognition();

    const backendOnline = await API.healthCheck();
    showToast(backendOnline ? 'Backend API connected' : 'Backend offline — frontend-only mode', backendOnline ? 'success' : 'warning');
    console.log('[App] Dashboard ready!');
  }

  async function loadData() {
    try {
      const counts = await DataStore.init();
      showToast(`Loaded ${counts.routes} routes, ${counts.stops} stops`, 'success');
      updateKPIs();
      renderRouteList();
      updateWeatherWidget();
      if (mapInitialized) MapManager.plotAllRoutes(DataStore, 15);
      populateRouteSelector();
      if (analyticsRendered) Analytics.render(DataStore);
    } catch (err) {
      console.error('[App] Data loading failed:', err);
      showToast('Failed to load data — check file paths', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();