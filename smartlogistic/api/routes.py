from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn
from core.predictor import DelayPredictor
from core.optimizer import RouteOptimizer

app = FastAPI(title="Smart Logistics Orchestrator", version="1.0")

# Initialize models into memory during cold start
print("[SYSTEM] Initializing ML Predictor and Graph Optimizer...")
predictor = DelayPredictor()
optimizer = RouteOptimizer()

class IncidentPayload(BaseModel):
    event_id: str
    affected_edge: str
    weather_condition: str
    traffic_level: str
    vehicle_type: str
    temperature_c: float
    total_distance_km: float
    source_node: str = "NodeA"  # Added routing parameter
    target_node: str = "NodeE"  # Added routing parameter

@app.post("/api/v1/optimize-route")
async def optimize_route(payload: IncidentPayload):
    try:
        # 1. Convert Pydantic payload to dictionary
        data = payload.model_dump()
        
        # 2. Predict penalty (Delay in minutes) using XGBoost
        additional_delay = predictor.predict(data)
        
        # 3. Recalculate route via Graph Algorithm (NetworkX)
        routing_result = optimizer.optimize_route(
            source=payload.source_node,
            target=payload.target_node,
            affected_edge=payload.affected_edge,
            penalty_minutes=additional_delay
        )
        
        if "error" in routing_result:
            raise HTTPException(status_code=400, detail=routing_result["error"])

        # 4. Return the finalized tactical decision
        return {
            "status": "success",
            "event_id": payload.event_id,
            "analysis": f"Detected {payload.weather_condition} weather and {payload.traffic_level} traffic.",
            "ml_predicted_delay_minutes": round(additional_delay, 2),
            "tactical_decision": {
                "action": "Route Recalculated via Dijkstra",
                "new_route": routing_result["new_route_nodes"],
                "total_estimated_time_minutes": routing_result["estimated_total_travel_time"]
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("api.routes:app", host="0.0.0.0", port=8000, reload=True)