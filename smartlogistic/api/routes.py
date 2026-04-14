from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles 
import uvicorn
import os
import copy
from core.predictor import DelayPredictor
from core.optimizer import RouteOptimizer

app = FastAPI(title="Smart Logistics Orchestrator", version="1.0")

# Initialize models into memory during cold start
print("[SYSTEM] Initializing ML Predictor...")
predictor = DelayPredictor()

# --- DİNAMİK MATRİS HARİTALAMASI (Sürekli Güncelleme İçin) ---
# UI'dan gelen "NodeA" gibi stringleri OR-Tools'un istediği 0,1,2 indekslerine çevirir.
NODE_MAP = {"NodeA": 0, "NodeB": 1, "NodeC": 2, "NodeD": 3, "NodeE": 4}
REVERSE_MAP = {v: k for k, v in NODE_MAP.items()}

# Normal hava/trafik şartlarındaki baz seyahat süreleri (dakika)
BASE_MATRIX = [
    [0, 15, 25, 999, 999], # NodeA (Depot)
    [15, 0, 15, 20, 999],  # NodeB
    [25, 15, 0, 10, 999],  # NodeC
    [999, 20, 10, 0, 30],  # NodeD
    [999, 999, 999, 30, 0] # NodeE
]

class IncidentPayload(BaseModel):
    event_id: str
    affected_edge: str
    weather_condition: str
    traffic_level: str
    vehicle_type: str
    temperature_c: float
    total_distance_km: float

@app.post("/api/v1/optimize-route")
async def optimize_route(payload: IncidentPayload):
    try:
        # 1. Sürekli Çıkarım (ML Inference): Krizin gecikme süresini hesapla
        data = payload.model_dump()
        additional_delay = int(predictor.predict(data)) # OR-Tools int matris bekler
        
        # 2. Canlı Matris Güncellemesi: Baz matrisi kopyala ve kriz cezasını ekle
        current_matrix = copy.deepcopy(BASE_MATRIX)
        
        if "-" in payload.affected_edge:
            u_str, v_str = payload.affected_edge.split("-")
            if u_str in NODE_MAP and v_str in NODE_MAP:
                u_idx = NODE_MAP[u_str]
                v_idx = NODE_MAP[v_str]
                # İlgili yolun maliyetini (süresini) ML tahmini kadar artır
                current_matrix[u_idx][v_idx] += additional_delay
                current_matrix[v_idx][u_idx] += additional_delay 

        # 3. OR-Tools Optimizasyonu
        # Araç sayısını 1, Depo indeksini 0 (NodeA) olarak başlat
        optimizer = RouteOptimizer(num_vehicles=1, depot_index=0)
        ortools_result = optimizer.solve(current_matrix)
        
        if not ortools_result:
            raise ValueError("OR-Tools geçerli bir rota bulamadı.")

        # 4. OR-Tools İndekslerini UI için String'e Çevir (0,2,1 -> NodeA, NodeC, NodeB)
        route_indices = ortools_result["vehicle_0"]["route"]
        new_route_nodes = [REVERSE_MAP[idx] for idx in route_indices]
        total_estimated_time = ortools_result["vehicle_0"]["distance"]

        return {
            "status": "success",
            "event_id": payload.event_id,
            "analysis": f"Detected {payload.weather_condition} weather and {payload.traffic_level} traffic.",
            "ml_predicted_delay_minutes": additional_delay,
            "tactical_decision": {
                "action": "OR-Tools dinamik matris ile durakları yeniden sıraladı.",
                "new_route": new_route_nodes,
                "total_estimated_time_minutes": total_estimated_time
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# UI Mount işlemleri
if os.path.exists("data"):
    app.mount("/data", StaticFiles(directory="data"), name="data")

if os.path.exists("ui"):
    app.mount("/", StaticFiles(directory="ui", html=True), name="ui")

if __name__ == "__main__":
    uvicorn.run("api.routes:app", host="0.0.0.0", port=8000, reload=True)