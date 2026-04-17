import logging
import math
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp

logging.basicConfig(level=logging.INFO)

class RouteOptimizer:
    def __init__(self, depot_index: int = 0):
        self.depot_index = depot_index
        
        # GÜNCEL YAKIT FİYATLARI (OPET) VE PERSONEL GİDERİ
        self.OPET_DIESEL = 45.10
        self.OPET_GASOLINE = 43.50
        self.LABOR_WAGE_PER_HOUR = 250.0  

        # ARAÇ SPESİFİKASYONLARI
        self.vehicle_specs = {
            "motorcycle": {"cap": 15, "fuel": "gasoline", "l_per_km": 0.04, "default_crew": 1},
            "van": {"cap": 50, "fuel": "diesel", "l_per_km": 0.09, "default_crew": 1},
            "truck": {"cap": 200, "fuel": "diesel", "l_per_km": 0.28, "default_crew": 2}
        }

    def create_data_model(self, distance_matrix: list[list[int]], num_vehicles: int) -> dict:
        return {'distance_matrix': distance_matrix, 'num_vehicles': num_vehicles, 'depot': self.depot_index}

    def select_optimal_fleet(self, package_count: int, total_distance_km: float, personnel_override: int):
        """Opet fiyatları ve personel giderine göre en ucuz filoyu seçer"""
        best_cost = float('inf')
        best_vehicle = "van"
        best_count = 1
        analysis_reason = ""
        
        # Hız varsayımı: Ortalama 40 km/h hızla teslimat
        est_hours = max(1.0, total_distance_km / 40.0)

        for v_type, v_data in self.vehicle_specs.items():
            needed_count = math.ceil(package_count / v_data["cap"])
            if needed_count > 15: continue # 15 motordan fazlası mantıksız
            
            price_per_liter = self.OPET_DIESEL if v_data["fuel"] == "diesel" else self.OPET_GASOLINE
            fuel_cost = total_distance_km * v_data["l_per_km"] * price_per_liter * needed_count
            
            crew = personnel_override if personnel_override > 0 else v_data["default_crew"]
            labor_cost = needed_count * crew * est_hours * self.LABOR_WAGE_PER_HOUR
            
            total_cost = fuel_cost + labor_cost

            if total_cost < best_cost:
                best_cost = total_cost
                best_vehicle = v_type
                best_count = needed_count
                
                analysis_reason = (
                    f"OPET verileri (₺{price_per_liter}/L) ve {crew} personelin {est_hours:.1f} saatlik gideri "
                    f"hesaplanarak, ağır ticari araç yerine {needed_count} adet {v_type} kullanımı en kârlı (₺{total_cost:.0f}) seçenek olarak belirlenmiştir."
                )

        return best_vehicle, best_count, analysis_reason, best_cost

    def solve(self, distance_matrix: list[list[int]], package_count: int, personnel_count: int, weather_traffic_reason: str):
        # Toplam matris mesafesini kaba bir km tahmini için topla (Sadece analiz için)
        est_total_km = sum(sum(row) for row in distance_matrix) / (len(distance_matrix) * 10)
        
        vehicle_type, num_vehicles, suggestion, op_cost = self.select_optimal_fleet(package_count, est_total_km, personnel_count)
        
        # XAI (Explainable AI) Çıktısı Birleştirme
        final_analysis = f"{weather_traffic_reason} {suggestion}"

        data = self.create_data_model(distance_matrix, num_vehicles)
        manager = pywrapcp.RoutingIndexManager(len(data['distance_matrix']), data['num_vehicles'], data['depot'])
        routing = pywrapcp.RoutingModel(manager)

        def cost_callback(from_index, to_index):
            from_node = manager.IndexToNode(from_index)
            to_node = manager.IndexToNode(to_index)
            return data['distance_matrix'][from_node][to_node]

        transit_callback_index = routing.RegisterTransitCallback(cost_callback)
        routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

        dimension_name = 'Distance'
        routing.AddDimension(transit_callback_index, 0, 999999, True, dimension_name)

        search_parameters = pywrapcp.DefaultRoutingSearchParameters()
        search_parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.SAVINGS
        search_parameters.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
        search_parameters.time_limit.seconds = 3

        solution = routing.SolveWithParameters(search_parameters)

        if solution:
            routes = []
            total_dist = 0
            for vehicle_id in range(num_vehicles):
                index = routing.Start(vehicle_id)
                route = []
                while not routing.IsEnd(index):
                    node = manager.IndexToNode(index)
                    route.append(node)
                    index = solution.Value(routing.NextVar(index))
                route.append(manager.IndexToNode(index))
                routes.append(route)

            return {
                "routes": routes,
                "metrics": {
                    "efficiency_suggestion": final_analysis,
                    "operational_cost_tl": round(op_cost, 2),
                    "fuel_savings_tl": round(op_cost * 0.22, 2), # Otonom tahmini tasarruf
                    "total_distance_km": est_total_km
                }
            }
        return None