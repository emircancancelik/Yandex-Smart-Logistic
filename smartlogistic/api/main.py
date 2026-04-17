from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib
import pandas as pd
import uvicorn

app = FastAPI()

# Frontend(port 5500) API(port 8000) connecting
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_methods=["*"],
    allow_headers=["*"],
)


model = joblib.load('/Users/emircancancelik/projects/py_projects/hackathons/smartlogistic/models/gb_delay_predictor.pkl')

class RoutePayload(BaseModel):
    event_id: str
    affected_edge: str
    weather_condition: str
    traffic_level: str
    vehicle_type: str
    temperature_c: float
    total_distance_km: float
    source_node: str
    target_node: str

@app.post("/api/v1/optimize-route")
async def optimize_route(payload: RoutePayload):
    try:
        input_data = pd.DataFrame([{
            "weather": payload.weather_condition,
            "traffic": payload.traffic_level,
            "temp": payload.temperature_c,
            "distance": payload.total_distance_km,
            "vehicle": payload.vehicle_type
        }])
        
        prediction = model.predict(input_data)[0]
        return {
            "status": "success",
            "predicted_delay": float(prediction),
            "optimized_path": [payload.source_node, "Node-X", payload.target_node], # Örnek rota
            "analysis": f"{payload.weather_condition} hava durumunda beklenen gecikme hesaplandı."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)