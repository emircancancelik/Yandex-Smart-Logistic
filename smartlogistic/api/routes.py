from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles 
import uvicorn
import os
import math
import copy

from core.predictor import DelayPredictor
from core.optimizer import RouteOptimizer

app = FastAPI(title="FlowStation Smart Logistics Orchestrator")

predictor = DelayPredictor()
optimizer = RouteOptimizer(depot_index=0)

class StopPoint(BaseModel):
    id: str
    lat: float
    lng: float

class IncidentPayload(BaseModel):
    event_id: str
    affected_edge: str
    weather_condition: str
    traffic_level: str
    vehicle_type: str
    temperature_c: float
    total_distance_km: float
    stops_to_visit: list[StopPoint] # Artık gerçek koordinatlar geliyor
    package_count: int
    personnel_count: int

def haversine_distance(lat1, lon1, lat2, lon2):
    """İki GPS koordinatı arasındaki mesafeyi (KM) hesaplar"""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

@app.post("/api/v1/optimize-route")
async def optimize_route(payload: IncidentPayload):
    try:
        data_dict = payload.model_dump()
        predicted_delay = int(predictor.predict(data_dict))
        
        stops = payload.stops_to_visit
        n = len(stops)
        if n < 2:
            raise HTTPException(status_code=400, detail="Optimizasyon için en az 2 durak gerekli.")

        # Gerçek GPS verilerinden dinamik maliyet/mesafe matrisi oluşturuluyor
        current_matrix = [[0] * n for _ in range(n)]
        node_ids = [s.id for s in stops]

        for i in range(n):
            for j in range(n):
                if i != j:
                    dist = haversine_distance(stops[i].lat, stops[i].lng, stops[j].lat, stops[j].lng)
                    current_matrix[i][j] = int(dist * 10) # OR-Tools integer bekler (x10 ile ölçekleme)
        
        # XGBoost Gecikme Cezasının Matrise İşlenmesi (XAI)
        weather_traffic_reason = ""
        if "-" in payload.affected_edge:
            u_str, v_str = payload.affected_edge.split("-")
            if u_str in node_ids and v_str in node_ids:
                u_idx, v_idx = node_ids.index(u_str), node_ids.index(v_str)
                # Gecikme olan yolu 100 kat zorlaştırarak algoritmayı o yoldan kaçırıyoruz
                current_matrix[u_idx][v_idx] += (predicted_delay * 100)
                current_matrix[v_idx][u_idx] += (predicted_delay * 100)
                weather_traffic_reason = f"{payload.weather_condition.upper()} hava ve yoğun trafik kaynaklı {u_str}-{v_str} güzergahındaki {predicted_delay} dk gecikme riski by-pass edilmiştir."

        res = optimizer.solve(current_matrix, payload.package_count, payload.personnel_count, weather_traffic_reason)
        
        if not res:
            raise HTTPException(status_code=400, detail="Optimizasyon motoru çözüm üretemedi.")

        # İndeksleri tekrar ID'lere çevir
        optimized_route_ids = [node_ids[idx] for idx in res["routes"][0]]

        return {
            "status": "success",
            "event_id": payload.event_id,
            "analysis": res["metrics"]["efficiency_suggestion"],
            "financial_impact": {
                "fuel_savings": res["metrics"]["fuel_savings_tl"],
                "total_op_cost": res["metrics"]["operational_cost_tl"]
            },
            "tactical_decision": {
                "action": "Kâr odaklı durak sıralaması tamamlandı.",
                "new_route": optimized_route_ids,
                "total_estimated_time_minutes": res["metrics"]["total_distance_km"]
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if os.path.exists(os.path.join(BASE_DIR, "data")): app.mount("/data", StaticFiles(directory=os.path.join(BASE_DIR, "data")), name="data")
if os.path.exists(os.path.join(BASE_DIR, "ui")): app.mount("/", StaticFiles(directory=os.path.join(BASE_DIR, "ui"), html=True), name="ui")

if __name__ == "__main__":
    uvicorn.run("api.routes:app", host="0.0.0.0", port=8000, reload=True)