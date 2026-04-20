/* =========================================================
   api.js — FINAL ATOMIC VERSION (FORCE GLOBAL)
   ========================================================= */

// Fonksiyonu doğrudan pencereye (global scope) bağlıyoruz
window.renderXAIScore = function(xaiData) {
    console.log("[XAI] Render tetiklendi, veri:", xaiData);
    if (!xaiData) return;

    const statusColor = xaiData.final_score >= 80 ? '#22c55e' : (xaiData.final_score >= 50 ? '#eab308' : '#ef4444');

    const xaiHTML = `
        <div id="xai-absolute-panel" style="position: fixed; bottom: 30px; right: 30px; z-index: 999999; width: 320px; background: white; box-shadow: 0 15px 35px rgba(0,0,0,0.4); border-radius: 12px; padding: 20px; font-family: sans-serif; border-left: 6px solid ${statusColor}; border-top: 1px solid #eee;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <h3 style="margin:0; font-size: 1.1rem; color: #1a202c;">XAI Güven Skoru</h3>
                <span style="font-size: 1.6rem; font-weight: 800; color: ${statusColor};">${xaiData.final_score}</span>
            </div>
            <div style="background: #f7fafc; padding: 12px; border-radius: 8px; font-size: 0.9rem;">
                <div style="display:flex; justify-content:space-between"><span>⏱ Gecikme:</span> <span style="color:#e53e3e">-${xaiData.penalties.delay}</span></div>
                <div style="display:flex; justify-content:space-between"><span>📏 Mesafe:</span> <span style="color:#e53e3e">-${xaiData.penalties.distance}</span></div>
                <div style="display:flex; justify-content:space-between"><span>⛈ Risk:</span> <span style="color:#e53e3e">-${xaiData.penalties.weather_risk}</span></div>
            </div>
            <p style="font-size: 0.75rem; color: #718096; margin-top: 12px; font-style: italic;">* ${xaiData.explanations.delay_exp}</p>
            <button onclick="this.parentElement.remove()" style="width:100%; margin-top:12px; padding:8px; border:none; background:#edf2f7; border-radius:6px; cursor:pointer; font-weight:bold;">Analizi Kapat</button>
        </div>
    `;

    const old = document.getElementById('xai-absolute-panel');
    if (old) old.remove();

    document.body.insertAdjacentHTML('beforeend', xaiHTML);
};

const API = {
    BASE_URL: '',

    async optimizeRoute(payload) {
        console.log('[API] Requesting Optimization...');
        const response = await fetch(`${this.BASE_URL}/api/v1/optimize-route`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error("API Error");

        const result = await response.json();
        console.log('[API] Result:', result);
        
        if (result.status === "success" && result.xai_analysis) {
            // UI'ın diğer her şeyi çizmesi için biraz bekle
            setTimeout(() => {
                window.renderXAIScore(result.xai_analysis);
            }, 800);
        }
        
        return result;
    },

    buildPayload(formData) {
        return {
            event_id: formData.eventId || `EVT-${Date.now()}`,
            affected_edge: formData.affectedEdge || "",
            weather_condition: formData.weatherCondition || "CLEAR",
            traffic_level: formData.trafficLevel || "LOW",
            vehicle_type: formData.vehicleType || "Standard",
            temperature_c: parseFloat(formData.temperatureC) || 15.0,
            total_distance_km: parseFloat(formData.totalDistanceKm) || 0.0,
            stops_to_visit: formData.stopsToVisit || [],
            package_count: parseInt(formData.packageCount, 10) || 0,
            personnel_count: parseInt(formData.personnelCount, 10) || 1,
            weight_type: formData.weightType || "balanced"
        };
    }
};

window.API = API; // API'yi de global yapalım garanti olsun