from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles 
import uvicorn
import os
import copy

# Kendi yazdığımız modülleri içe aktarıyoruz
from core.predictor import DelayPredictor
from core.optimizer import RouteOptimizer

app = FastAPI(title="FlowStation Smart Logistics Orchestrator", version="2.0")

# Modelleri ve Optimizer'ı belleğe alıyoruz
predictor = DelayPredictor()
optimizer = RouteOptimizer(depot_index=0)

# --- 1. PAYLOAD MODELİ (Frontend'den gelecek verinin yapısı) ---
class IncidentPayload(BaseModel):
    event_id: str
    affected_edge: str
    weather_condition: str
    traffic_level: str
    vehicle_type: str
    temperature_c: float
    total_distance_km: float
    stops_to_visit: list[str]
    package_count: int  # CSV'den gelen gerçek paket sayısı

# --- 2. DİNAMİK MATRİS HARİTALAMASI ---
NODE_MAP = {"NodeA": 0, "NodeB": 1, "NodeC": 2, "NodeD": 3, "NodeE": 4}
REVERSE_MAP = {v: k for k, v in NODE_MAP.items()}

BASE_MATRIX = [
    [0, 15, 25, 999, 999], [15, 0, 15, 20, 999],
    [25, 15, 0, 10, 999], [999, 20, 10, 0, 30],
    [999, 999, 999, 30, 0]
]

# --- 3. ASIL POST METODU (İletişim Noktası) ---
@app.post("/api/v1/optimize-route")
async def optimize_route(payload: IncidentPayload):
    try:
        # A. Sürekli Çıkarım (ML): Gecikme süresini tahmin et
        data_dict = payload.model_dump()
        predicted_delay = int(predictor.predict(data_dict))
        
        # B. Matrisi Güncelle: Kriz anındaki maliyet artışını ekle
        current_matrix = copy.deepcopy(BASE_MATRIX)
        if "-" in payload.affected_edge:
            u_str, v_str = payload.affected_edge.split("-")
            if u_str in NODE_MAP and v_str in NODE_MAP:
                u_idx, v_idx = NODE_MAP[u_str], NODE_MAP[v_str]
                current_matrix[u_idx][v_idx] += predicted_delay
                current_matrix[v_idx][u_idx] += predicted_delay

        # C. Kâr Odaklı OR-Tools Optimizasyonu
        # Payload'dan gelen GERÇEK paket sayısını buraya gönderiyoruz
        res = optimizer.solve(current_matrix, payload.package_count)
        
        if not res:
            raise HTTPException(status_code=400, detail="Optimizasyon motoru çözüm üretemedi.")

        # D. Sonuçları Frontend Formatına Çevir
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
                "new_route": [REVERSE_MAP[idx] for idx in res["routes"][0]],
                "total_estimated_time_minutes": res["metrics"]["total_distance_km"]
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Static Files (UI ve Veri)
if os.path.exists("data"):
    app.mount("/data", StaticFiles(directory="data"), name="data")
if os.path.exists("ui"):
    app.mount("/", StaticFiles(directory="ui", html=True), name="ui")

if __name__ == "__main__":
    uvicorn.run("api.routes:app", host="0.0.0.0", port=8000, reload=True)