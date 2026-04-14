import logging
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp

logging.basicConfig(level=logging.INFO)

class RouteOptimizer:
    def __init__(self, num_vehicles: int, depot_index: int = 0):
        """
        Lojistik ağ optimizasyon motorunu başlatır.
        
        Args:
            num_vehicles (int): Dağıtım yapacak toplam araç sayısı.
            depot_index (int): Araçların çıkış ve dönüş yapacağı ana deponun matris indeksi.
        """
        self.num_vehicles = num_vehicles
        self.depot_index = depot_index
        self.manager = None
        self.routing = None

    def create_data_model(self, distance_matrix: list[list[int]]) -> dict:
        """
        OR-Tools çözücüsü için gerekli veri modelini oluşturur.
        """
        return {
            'distance_matrix': distance_matrix,
            'num_vehicles': self.num_vehicles,
            'depot': self.depot_index
        }

    def solve(self, distance_matrix: list[list[int]]):
        """
        Verilen mesafe matrisi üzerinden rotaları optimize eder.
        """
        data = self.create_data_model(distance_matrix)

        # 1. Yönlendirme Yöneticisini (Routing Index Manager) Başlat
        self.manager = pywrapcp.RoutingIndexManager(
            len(data['distance_matrix']), 
            data['num_vehicles'], 
            data['depot']
        )

        # 2. Yönlendirme Modelini Başlat
        self.routing = pywrapcp.RoutingModel(self.manager)

        # 3. Mesafe Geri Çağırım (Callback) Fonksiyonunu Tanımla
        def distance_callback(from_index, to_index):
            """İki düğüm arasındaki mesafeyi döndürür."""
            from_node = self.manager.IndexToNode(from_index)
            to_node = self.manager.IndexToNode(to_index)
            return data['distance_matrix'][from_node][to_node]

        transit_callback_index = self.routing.RegisterTransitCallback(distance_callback)

        # 4. Maliyet Fonksiyonunu Ayarla (Amaç: Toplam mesafeyi minimize et)
        self.routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

        # 5. Mesafe Boyutunu (Dimension) Ekle
        # Bu, araçların kat edebileceği maksimum mesafeyi sınırlar (şu anlık sınır 3000)
        dimension_name = 'Distance'
        self.routing.AddDimension(
            transit_callback_index,
            0,  # Bekleme süresi (slack) - mesafe için 0
            3000,  # Bir aracın kat edebileceği maksimum yol birimi
            True,  # Mesafe 0'dan mı başlasın?
            dimension_name
        )

        # 6. Çözücü Parametrelerini Ayarla (Arama Stratejisi)
        search_parameters = pywrapcp.DefaultRoutingSearchParameters()
        search_parameters.first_solution_strategy = (
            routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC)
        
        # Yerel arama ile sonuçu iyileştir (Metaheuristics)
        search_parameters.local_search_metaheuristic = (
            routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH)
        search_parameters.time_limit.seconds = 3 # Algoritmanın maksimum arama süresi

        # 7. Çözümü Bul
        logging.info("Optimizasyon başlatıldı, hesaplanıyor...")
        solution = self.routing.SolveWithParameters(search_parameters)

        if solution:
            return self._extract_routes(data, solution)
        else:
            logging.error("Herhangi bir çözüm bulunamadı.")
            return None

    def _extract_routes(self, data: dict, solution) -> dict:
        """
        Çözüm nesnesini parçalayarak JSON/Dict formatında okunabilir rotalara dönüştürür.
        """
        routes = {}
        total_distance = 0
        
        for vehicle_id in range(data['num_vehicles']):
            index = self.routing.Start(vehicle_id)
            plan_output = []
            route_distance = 0
            
            while not self.routing.IsEnd(index):
                plan_output.append(self.manager.IndexToNode(index))
                previous_index = index
                index = solution.Value(self.routing.NextVar(index))
                route_distance += self.routing.GetArcCostForVehicle(previous_index, index, vehicle_id)
            
            plan_output.append(self.manager.IndexToNode(index))
            routes[f"vehicle_{vehicle_id}"] = {
                "route": plan_output,
                "distance": route_distance
            }
            total_distance += route_distance

        routes["summary"] = {"total_network_distance": total_distance}
        return routes

# Kullanım Testi
if __name__ == "__main__":
    # 4 lokasyonlu örnek bir mesafe matrisi (0. indeks depo)
    sample_matrix = [
        [0, 2451, 713, 1018],
        [2451, 0, 1745, 1524],
        [713, 1745, 0, 355],
        [1018, 1524, 355, 0]
    ]
    
    # 2 araçlık bir filo ile optimizasyon başlat
    optimizer = RouteOptimizer(num_vehicles=2)
    result = optimizer.solve(sample_matrix)
    print(result)