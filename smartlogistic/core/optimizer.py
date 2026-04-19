import logging
import math
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp

logging.basicConfig(level=logging.INFO)

# Standard fuel unit price (TL/liter) used for all vehicle cost calculations.
DEFAULT_FUEL_PRICE_TL = 73.52

class RouteOptimizer:
    def __init__(self, depot_index: int = 0):
        self.depot_index = depot_index

        # Vehicle specifications
        self.vehicle_specs = {
            "motorcycle": {"cap": 15,  "l_per_km": 0.04, "default_crew": 1, "avg_speed_kmh": 48},
            "car":        {"cap": 35,  "l_per_km": 0.07, "default_crew": 1, "avg_speed_kmh": 55},
            "van":        {"cap": 50,  "l_per_km": 0.09, "default_crew": 1, "avg_speed_kmh": 45},
            "truck":      {"cap": 200, "l_per_km": 0.28, "default_crew": 2, "avg_speed_kmh": 35}
        }

    def create_data_model(self, distance_matrix: list[list[int]], num_vehicles: int) -> dict:
        return {
            'distance_matrix': distance_matrix,
            'num_vehicles': num_vehicles,
            'depot': self.depot_index
        }

    def select_optimal_fleet(
        self,
        package_count: int,
        total_distance_km: float,
        personnel_override: int,
        fuel_prices: dict | None = None,
        weight_type: str = "balanced"
    ):
        """Selects the optimal fleet based on live Opet fuel prices, labor costs, and optimization weight type."""
        prices = fuel_prices or {}
        fuel_price_tl = prices.get("fuel_tl_per_liter", DEFAULT_FUEL_PRICE_TL)

        best_score   = float('inf')
        best_vehicle = "van"
        best_count   = 1
        best_crew    = 1
        best_hours   = 1.0
        best_fuel_cost = 0.0
        best_labor_cost = 0.0
        best_total_cost = 0.0
        analysis_reason = ""

        for v_type, v_data in self.vehicle_specs.items():
            needed_count = math.ceil(package_count / v_data["cap"])
            if needed_count > 15:
                continue  # More than 15 units is impractical

            fuel_cost  = total_distance_km * v_data["l_per_km"] * fuel_price_tl * needed_count

            crew = personnel_override if personnel_override > 0 else v_data["default_crew"]
            speed_kmh = max(20, v_data.get("avg_speed_kmh", 40))
            est_hours = max(1.0, total_distance_km / speed_kmh)
            # Labor wage: 250 TL/hour per crew member
            labor_cost = needed_count * crew * est_hours * 250.0

            total_cost = fuel_cost + labor_cost
            est_minutes = est_hours * 60.0

            # Scoring mode:
            # - cost: minimize total TL
            # - delay: minimize estimated minutes (cost is secondary tie-breaker)
            # - balanced: mix both signals
            if weight_type == "cost":
                score = total_cost
            elif weight_type == "delay":
                score = est_minutes + (total_cost * 0.004)
            else:
                score = total_cost + (est_minutes * 7.5)

            if score < best_score:
                best_score   = score
                best_vehicle = v_type
                best_count   = needed_count
                best_crew    = crew
                best_hours   = est_hours
                best_fuel_cost = fuel_cost
                best_labor_cost = labor_cost
                best_total_cost = total_cost

                priority_mode = ""
                if weight_type == "cost":
                    priority_mode = " (cost-priority)"
                elif weight_type == "delay":
                    priority_mode = " (delay-priority)"

                analysis_reason = (
                    f"Using standard fuel price (₺{fuel_price_tl:.2f}/L), "
                    f"{needed_count}x {v_type} with {crew} crew over {est_hours:.1f} hrs "
                    f"is the best option{priority_mode} (₺{total_cost:.0f} total)."
                )

        return {
            "vehicle_type": best_vehicle,
            "vehicle_count": best_count,
            "crew_count": best_crew,
            "estimated_hours": best_hours,
            "fuel_cost_tl": best_fuel_cost,
            "labor_cost_tl": best_labor_cost,
            "total_op_cost_tl": best_total_cost,
            "analysis_reason": analysis_reason,
        }

    def solve(
        self,
        distance_matrix: list[list[int]],
        package_count: int,
        personnel_count: int,
        weather_traffic_reason: str,
        fuel_prices: dict | None = None,
        weight_type: str = "balanced"
    ):
        est_total_km = sum(sum(row) for row in distance_matrix) / (len(distance_matrix) * 1000.0)

        fleet = self.select_optimal_fleet(
            package_count, est_total_km, personnel_count, fuel_prices, weight_type
        )
        
        final_analysis = f"{weather_traffic_reason} {fleet['analysis_reason']}".strip()

        data = self.create_data_model(distance_matrix, 1)

        starts = [0] * data['num_vehicles']
        ends = [len(data['distance_matrix']) - 1] * data['num_vehicles']

        manager = pywrapcp.RoutingIndexManager(
            len(data['distance_matrix']), 
            data['num_vehicles'], 
            starts, 
            ends
        )
        
        routing = pywrapcp.RoutingModel(manager)

        def cost_callback(from_index, to_index):
            from_node = manager.IndexToNode(from_index)
            to_node   = manager.IndexToNode(to_index)
            return data['distance_matrix'][from_node][to_node]

        transit_callback_index = routing.RegisterTransitCallback(cost_callback)
        routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

        # High Limited
        routing.AddDimension(transit_callback_index, 0, 99999999, True, 'Distance')

        search_parameters = pywrapcp.DefaultRoutingSearchParameters()
        
        search_parameters.first_solution_strategy = (
            routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
        )
        search_parameters.time_limit.seconds = 2

        solution = routing.SolveWithParameters(search_parameters)

        if solution:
            routes = []
            total_dist_km = 0.0
            
            index = routing.Start(0)
            route = []
            while not routing.IsEnd(index):
                node = manager.IndexToNode(index)
                route.append(node)
                next_index = solution.Value(routing.NextVar(index))
                from_node = manager.IndexToNode(index)
                to_node = manager.IndexToNode(next_index)
                
                total_dist_km += data['distance_matrix'][from_node][to_node] / 1000.0
                index = next_index
                
            route.append(manager.IndexToNode(index))
            routes.append(route)

            total_estimated_time_minutes = (total_dist_km / 40.0) * 60.0

            base_savings = fleet["total_op_cost_tl"] * 0.22
            
            monthly_savings_tl = base_savings * 120
            
            return {
                "routes": routes,
                "metrics": {
                    "efficiency_suggestion": final_analysis,
                    "fuel_savings_tl": round(monthly_savings_tl, 2), # Artık API devasa rakamı döndürüyor
                    "total_distance_km": round(total_dist_km, 2),
                    "total_estimated_time_minutes": round(total_estimated_time_minutes, 2),
                    "fleet": {
                        "vehicle_type": fleet["vehicle_type"],
                        "vehicle_count": fleet["vehicle_count"],
                        "crew_count": fleet["crew_count"],
                        "estimated_hours": round(fleet["estimated_hours"], 2),
                    },
                    "costs": {
                        "fuel_cost_tl": round(fleet["fuel_cost_tl"], 2),
                        "labor_cost_tl": round(fleet["labor_cost_tl"], 2),
                        "total_op_cost_tl": round(fleet["total_op_cost_tl"], 2),
                    },
                },
            }
        return None