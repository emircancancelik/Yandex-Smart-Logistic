/* =========================================================
   api.js — Backend API Communication Layer
   Handles all HTTP requests to the FastAPI backend
   ========================================================= */

const API = {
  BASE_URL: 'http://localhost:8000',

  /**
   * POST /api/v1/optimize-route
   * Sends incident data, receives ML prediction + optimized route
   */
  async optimizeRoute(payload) {
    const url = `${this.BASE_URL}/api/v1/optimize-route`;

    console.log('[API] Sending optimization request:', payload);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('[API] Optimization result:', result);
    return result;
  },

  /**
   * Health check — tries to reach the backend
   */
  async healthCheck() {
    try {
      const response = await fetch(`${this.BASE_URL}/docs`, { method: 'HEAD', mode: 'no-cors' });
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Build a standardized payload from form values
   */
  buildPayload(formData) {
    return {
      event_id: formData.eventId || `EVT-${Date.now()}`,
      affected_edge: formData.affectedEdge,
      weather_condition: formData.weatherCondition,
      traffic_level: formData.trafficLevel,
      vehicle_type: formData.vehicleType,
      temperature_c: parseFloat(formData.temperatureC) || 15.0,
      total_distance_km: parseFloat(formData.totalDistanceKm) || 200.0,
      source_node: formData.sourceNode || 'NodeA',
      target_node: formData.targetNode || 'NodeE'
    };
  }
};
