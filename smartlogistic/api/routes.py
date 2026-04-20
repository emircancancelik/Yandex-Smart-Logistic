from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
import uvicorn
import os
import math
import copy
import httpx
import re

from datetime import datetime, timezone
from core.evaluater import RouteXAIEvaluator
from core.predictor import DelayPredictor
from core.optimizer import RouteOptimizer, DEFAULT_FUEL_PRICE_TL

app = FastAPI(title="FlowStation Smart Logistics Orchestrator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

predictor = DelayPredictor()
optimizer = RouteOptimizer(depot_index=0)
xai_evaluator = RouteXAIEvaluator()

# ─── In-memory fuel price cache ───
_fuel_price_cache = {
    "fuel_tl_per_liter": DEFAULT_FUEL_PRICE_TL,
    "source": "fallback",
    "updated_at": datetime.now(timezone.utc).isoformat()
}


# ─── Models ───
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
    stops_to_visit: list[StopPoint]
    package_count: int
    personnel_count: int
    weight_type: str = "balanced"  # cost, balanced, or delay


def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculates the distance (km) between two GPS coordinates using Haversine formula."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


# ─── Fuel Prices Endpoint ───
PROVINCE_CODES = {
    "adana": 1, "adiyaman": 2, "afyonkarahisar": 3, "agri": 4, "amasya": 5,
    "ankara": 6, "antalya": 7, "artvin": 8, "aydin": 9, "balikesir": 10,
    "bilecik": 11, "bingol": 12, "bitlis": 13, "bolu": 14, "burdur": 15,
    "bursa": 16, "canakkale": 17, "cankiri": 18, "corum": 19, "denizli": 20,
    "diyarbakir": 21, "edirne": 22, "elazig": 23, "erzincan": 24, "erzurum": 25,
    "eskisehir": 26, "gaziantep": 27, "giresun": 28, "gumushane": 29, "hakkari": 30,
    "hatay": 31, "isparta": 32, "mersin": 33, "istanbul": 34, "izmir": 35,
    "kars": 36, "kastamonu": 37, "kayseri": 38, "kirklareli": 39, "kirsehir": 40,
    "kocaeli": 41, "konya": 42, "kutahya": 43, "malatya": 44, "manisa": 45,
    "kahramanmaras": 46, "mardin": 47, "mugla": 48, "mus": 49, "nevsehir": 50,
    "nigde": 51, "ordu": 52, "rize": 53, "sakarya": 54, "samsun": 55,
    "siirt": 56, "sinop": 57, "sivas": 58, "tekirdag": 59, "tokat": 60,
    "trabzon": 61, "tunceli": 62, "sanliurfa": 63, "usak": 64, "van": 65,
    "yozgat": 66, "zonguldak": 67, "aksaray": 68, "bayburt": 69, "karaman": 70,
    "kirikkale": 71, "batman": 72, "sirnak": 73, "bartin": 74, "ardahan": 75,
    "igdir": 76, "yalova": 77, "karabuk": 78, "kilis": 79, "osmaniye": 80,
    "duzce": 81
}

def clean_turkish_chars(text):
    if not text: return ""
    replacements = {
        'ı': 'i', 'İ': 'I', 'ş': 's', 'Ş': 'S', 'ğ': 'g', 'Ğ': 'G',
        'ü': 'u', 'Ü': 'U', 'ö': 'o', 'Ö': 'O', 'ç': 'c', 'Ç': 'C'
    }
    for search, replace in replacements.items():
        text = text.replace(search, replace)
    return text.lower()

@app.get("/api/v1/fuel-prices")
async def get_fuel_prices(lat: float = None, lng: float = None):
    """
    Returns current Opet fuel prices (TL/liter).
    Attempts live fetch from Opet API based on geolocation.
    """
    global _fuel_price_cache

    province_code = 58 # Default Sivas
    province_name = "Sivas"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            if lat is not None and lng is not None:
                # Reverse geocoding to find province
                nom_url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lng}&format=json"
                nom_res = await client.get(nom_url, headers={"User-Agent": "FlowStationLogisticsApp"})
                if nom_res.status_code == 200:
                    address = nom_res.json().get("address", {})
                    found_prov = address.get("province") or address.get("state") or address.get("city")
                    if found_prov:
                        clean_prov = clean_turkish_chars(found_prov).replace(" province", "").strip()
                        if clean_prov in PROVINCE_CODES:
                            province_code = PROVINCE_CODES[clean_prov]
                            province_name = found_prov
    except Exception as e:
        print(f"[FuelPrices] Geocoding failed: {e}")

    # Opet API
    OPET_PRICES_URL = "https://api.opet.com.tr/api/fuelprices"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Referer": "https://www.opet.com.tr/akaryakit-fiyatlari",
        "Origin": "https://www.opet.com.tr"
    }

    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            tried = [
                f"{OPET_PRICES_URL}?il={province_code}",
                f"{OPET_PRICES_URL}/{province_code}",
                f"https://api.opet.com.tr/api/fuelprices/city/{province_code}/prices",
                f"https://www.opet.com.tr/api/fuelprices?provinceId={province_code}",
            ]
            data = None
            for url in tried:
                try:
                    r = await client.get(url, headers=headers)
                    if r.status_code == 200:
                        data = r.json()
                        break
                except Exception:
                    continue

            if data:
                gasoline = None
                diesel   = None
                lpg      = None
                items    = data if isinstance(data, list) else data.get("data", [])
                for item in items:
                    name = str(item.get("name", "")).lower()
                    price = float(item.get("price", 0) or item.get("satisFiyati", 0))
                    if "benzin" in name or "gasoline" in name or "95" in name:
                        gasoline = price
                    elif "motorin" in name or "diesel" in name:
                        diesel = price
                    elif "lpg" in name or "otogaz" in name:
                        lpg = price

                if gasoline or diesel or lpg:
                    # Single fuel pricing parameter for dispatcher workflow.
                    fuel_price_tl = diesel or gasoline or lpg or DEFAULT_FUEL_PRICE_TL
                    _fuel_price_cache = {
                        "fuel_tl_per_liter": fuel_price_tl,
                        "source": f"opet_api_live ({province_name})",
                        "updated_at": datetime.now(timezone.utc).isoformat()
                    }
                    return _fuel_price_cache

    except Exception as e:
        print(f"[FuelPrices] Opet API fetch failed: {e}")

    # Fallback, update the source to show it's a fallback with the attempted province
    fallback_cache = dict(_fuel_price_cache)
    fallback_cache["source"] = f"fallback ({province_name})"
    return fallback_cache


# ─── Route Optimization Endpoint ───
@app.post("/api/v1/optimize-route")
async def optimize_route(payload: IncidentPayload):
    try:
        data_dict       = payload.model_dump()
        predicted_delay = int(predictor.predict(data_dict))

        stops = payload.stops_to_visit
        n     = len(stops)
        if n < 2:
            raise HTTPException(status_code=400, detail="At least 2 stops required for optimization.")

        # Build distance matrix from real GPS coordinates (Haversine)
        base_matrix = [[0] * n for _ in range(n)]
        node_ids       = [s.id for s in stops]

        for i in range(n):
            for j in range(n):
                if i != j:
                    dist = haversine_distance(
                        stops[i].lat, stops[i].lng,
                        stops[j].lat, stops[j].lng
                    )
                    base_matrix[i][j] = int(dist * 1000)  # OR-Tools expects integers (x10 scaling)

        # Apply XGBoost delay penalty to the affected edge (XAI)
        weighted_matrix = copy.deepcopy(base_matrix)
        weather_traffic_reason = ""
        weight_type = (payload.weight_type or "balanced").lower()
        if weight_type not in {"cost", "balanced", "delay"}:
            weight_type = "balanced"

        penalty_multiplier = {
            "cost": 0.35,
            "balanced": 1.0,
            "delay": 3.2,
        }

        affected_nodes = re.findall(r"(?:STP-\d+|Node[A-Z])", payload.affected_edge or "")
        if len(affected_nodes) >= 2:
            u_str, v_str = affected_nodes[0], affected_nodes[1]
            if u_str in node_ids and v_str in node_ids:
                u_idx, v_idx = node_ids.index(u_str), node_ids.index(v_str)
                edge_penalty = int(predicted_delay * 666 * penalty_multiplier[weight_type])
                weighted_matrix[u_idx][v_idx] += edge_penalty
                weighted_matrix[v_idx][u_idx] += edge_penalty

                mode_text = {
                    "cost": "Cost priority (lighter delay penalty)",
                    "balanced": "Balanced priority",
                    "delay": "Delay priority (aggressive delay avoidance)",
                }[weight_type]
                weather_traffic_reason = (
                    f"{predicted_delay}-min delay risk on {u_str}–{v_str} "
                    f"({payload.weather_condition.upper()} weather + {payload.traffic_level} traffic) bypassed. "
                    f"{mode_text}."
                )

        # Use live fuel prices if available
        res = optimizer.solve(
            weighted_matrix,
            payload.package_count,
            payload.personnel_count,
            weather_traffic_reason,
            fuel_prices=_fuel_price_cache,
            weight_type=weight_type,
            vehicle_type=payload.vehicle_type
        )

        # Delay-priority should not produce a worse ETA than an unweighted delay solve.
        if weight_type == "delay":
            baseline_delay_res = optimizer.solve(
                base_matrix,
                payload.package_count,
                payload.personnel_count,
                weather_traffic_reason,
                fuel_prices=_fuel_price_cache,
                weight_type="delay",
                vehicle_type=payload.vehicle_type
            )

            if baseline_delay_res and not res:
                res = baseline_delay_res

            if baseline_delay_res and res:
                if baseline_delay_res["metrics"]["total_estimated_time_minutes"] < res["metrics"]["total_estimated_time_minutes"]:
                    res = baseline_delay_res
                    suggestion = res["metrics"].get("efficiency_suggestion", "").strip()
                    res["metrics"]["efficiency_suggestion"] = (
                        f"{suggestion} Fallback applied: selected lower-ETA delay route."
                    ).strip()

        if not res:
            raise HTTPException(status_code=400, detail="Optimization engine could not find a solution.")

        optimized_route_ids = [node_ids[idx] for idx in res["routes"][0]]
        # OR-Tools route closes the tour by returning to the depot; UI expects unique stop order only.
        if len(optimized_route_ids) > 1 and optimized_route_ids[0] == optimized_route_ids[-1]:
            optimized_route_ids = optimized_route_ids[:-1]

        xai_result = xai_evaluator.calculate_score(
            delay_minutes=predicted_delay,
            distance_km=res["metrics"]["total_distance_km"],
            weather_condition=payload.weather_condition
        )

        return {
            "status": "success",
            "event_id": payload.event_id,
            "ml_predicted_delay_minutes": predicted_delay,
            "analysis": res["metrics"]["efficiency_suggestion"],
            "xai_analysis": xai_result,
            "ml_metrics": {
                "affected_edge": payload.affected_edge,
                "predicted_delay_min": predicted_delay,
            },
            "financial_impact": {
                "fuel_savings_tl": res["metrics"]["fuel_savings_tl"],
                "fuel_cost_tl": res["metrics"]["costs"]["fuel_cost_tl"],
                "labor_cost_tl": res["metrics"]["costs"]["labor_cost_tl"],
                "total_op_cost_tl": res["metrics"]["costs"]["total_op_cost_tl"],
            },
            "optimization": {
                "fleet": res["metrics"]["fleet"],
                "eta": {
                    "total_estimated_time_minutes": res["metrics"]["total_estimated_time_minutes"],
                    "total_distance_km": res["metrics"]["total_distance_km"],
                },
            },
            "tactical_decision": {
                "action": "Profit-focused stop ordering complete.",
                "new_route": optimized_route_ids,
                "total_estimated_time_minutes": res["metrics"]["total_estimated_time_minutes"],
                "total_distance_km": res["metrics"]["total_distance_km"],
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if os.path.exists(os.path.join(BASE_DIR, "data")):
    app.mount("/data", StaticFiles(directory=os.path.join(BASE_DIR, "data")), name="data")
if os.path.exists(os.path.join(BASE_DIR, "ui")):
    app.mount("/", StaticFiles(directory=os.path.join(BASE_DIR, "ui"), html=True), name="ui")

if __name__ == "__main__":
    uvicorn.run("api.routes:app", host="0.0.0.0", port=8000, reload=True)