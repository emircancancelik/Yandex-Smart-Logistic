import logging
import math
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp

logging.basicConfig(level=logging.INFO)

class RouteOptimizer:
    def __init__(self, depot_index: int = 0):
        """
        Lojistik ağ optimizasyon motorunu başlatır.

        Args:
            depot_index (int): Araçların çıkış ve dönüş yapacağı ana deponun matris indeksi.
        """
        self.depot_index = depot_index
        self.manager = None
        self.routing = None

        # Araç Konfigürasyonları (Birim Maliyetler)
        self.vehicle_specs = {
            "van": {
                "capacity": 50,
                "km_cost": 5.0,    # TL/KM
                "fixed_cost": 200,  # Günlük amortisman + personel
                "fuel_efficiency": 0.08  # Litre/KM (Simülasyon için)
            },
            "truck": {
                "capacity": 200,
                "km_cost": 12.0,
                "fixed_cost": 450,
                "fuel_efficiency": 0.25
            }
        }

    def create_data_model(self, distance_matrix: list[list[int]], num_vehicles: int) -> dict:
        """
        OR-Tools çözücüsü için gerekli veri modelini oluşturur.
        """
        return {
            'distance_matrix': distance_matrix,
            'num_vehicles': num_vehicles,
            'depot': self.depot_index
        }

    def select_optimal_fleet(self, package_count: int):
        """
        Paket sayısına göre maliyet analizi yaparak araç tipini ve sayısını belirler.
        """
        # Seçenek 1: Kamyon kullanımı
        truck_needed = math.ceil(package_count / self.vehicle_specs["truck"]["capacity"])
        truck_total_fixed = truck_needed * self.vehicle_specs["truck"]["fixed_cost"]

        # Seçenek 2: Van kullanımı
        van_needed = math.ceil(package_count / self.vehicle_specs["van"]["capacity"])
        van_total_fixed = van_needed * self.vehicle_specs["van"]["fixed_cost"]

        # 1 Kamyon vs N Van maliyet karşılaştırması (Kaba tahmin)
        if package_count <= 100 and van_total_fixed < truck_total_fixed:
            suggestion = f"{van_needed}x Van kullanımı, operasyonel sabit maliyeti %{round((1 - van_total_fixed / truck_total_fixed) * 100)} düşürür."
            return "van", van_needed, suggestion
        else:
            return "truck", truck_needed, "Mevcut yük hacmi için Kamyon kullanımı optimize edilmiştir."

    def solve(self, distance_matrix: list[list[int]], package_count: int):
        """
        Verilen mesafe matrisi ve paket sayısı üzerinden rotaları optimize eder.
        """
        vehicle_type, num_vehicles, suggestion = self.select_optimal_fleet(package_count)
        spec = self.vehicle_specs[vehicle_type]

        data = self.create_data_model(distance_matrix, num_vehicles)

        # 1. Yönlendirme Yöneticisini (Routing Index Manager) Başlat
        self.manager = pywrapcp.RoutingIndexManager(
            len(data['distance_matrix']),
            data['num_vehicles'],
            data['depot']
        )

        # 2. Yönlendirme Modelini Başlat
        self.routing = pywrapcp.RoutingModel(self.manager)

        # 3. Maliyet Geri Çağırım (Callback) Fonksiyonunu Tanımla
        def cost_callback(from_index, to_index):
            """İki düğüm arasındaki mesafeye dayalı operasyonel maliyeti döndürür."""
            from_node = self.manager.IndexToNode(from_index)
            to_node = self.manager.IndexToNode(to_index)
            # Maliyet = Mesafe * KM Başına Yakıt/Bakım Maliyeti
            distance = data['distance_matrix'][from_node][to_node]
            return int(distance * spec["km_cost"])

        transit_callback_index = self.routing.RegisterTransitCallback(cost_callback)

        # 4. Maliyet Fonksiyonunu Ayarla (Amaç: Toplam operasyonel maliyeti minimize et)
        self.routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

        # 5. Mesafe Boyutunu (Dimension) Ekle
        # Bu, araçların kat edebileceği maksimum mesafeyi sınırlar
        dimension_name = 'Distance'
        self.routing.AddDimension(
            transit_callback_index,
            0,     # Bekleme süresi (slack) - mesafe için 0
            3000,  # Bir aracın kat edebileceği maksimum yol birimi
            True,  # Mesafe 0'dan mı başlasın?
            dimension_name
        )

        # 6. Çözücü Parametrelerini Ayarla (Arama Stratejisi)
        search_parameters = pywrapcp.DefaultRoutingSearchParameters()
        search_parameters.first_solution_strategy = (
            routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC)

        # Yerel arama ile sonucu iyileştir (Metaheuristics)
        search_parameters.local_search_metaheuristic = (
            routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH)
        search_parameters.time_limit.seconds = 3  # Algoritmanın maksimum arama süresi

        # 7. Çözümü Bul
        logging.info("Optimizasyon başlatıldı, hesaplanıyor...")
        solution = self.routing.SolveWithParameters(search_parameters)

        if solution:
            return self._extract_results(data, solution, spec, num_vehicles, suggestion)
        else:
            logging.error("Herhangi bir çözüm bulunamadı.")
            return None

    def _extract_results(self, data: dict, solution, spec: dict, num_vehicles: int, suggestion: str) -> dict:
        """
        Çözüm nesnesini parçalayarak JSON/Dict formatında okunabilir rotalara ve
        operasyonel metriklere dönüştürür.
        """
        total_distance = 0
        routes = []

        for vehicle_id in range(num_vehicles):
            index = self.routing.Start(vehicle_id)
            route = []
            route_distance = 0

            while not self.routing.IsEnd(index):
                route.append(self.manager.IndexToNode(index))
                previous_index = index
                index = solution.Value(self.routing.NextVar(index))
                route_distance += self.routing.GetArcCostForVehicle(
                    previous_index, index, vehicle_id
                ) / spec["km_cost"]

            route.append(self.manager.IndexToNode(index))
            total_distance += route_distance
            routes.append(route)

        total_op_cost = (total_distance * spec["km_cost"]) + (num_vehicles * spec["fixed_cost"])

        # Tasarruf Hesabı: Optimizasyon öncesi (Random sıralama) vs Sonrası
        # Bu değer gerçek sistemde tarihsel veriden çekilir; simülasyonda %18 baz alınır.
        estimated_savings = total_op_cost * 0.18

        return {
            "routes": routes,
            "vehicle_type": spec,
            "metrics": {
                "total_distance_km": round(total_distance, 2),
                "operational_cost_tl": round(total_op_cost, 2),
                "fuel_savings_tl": round(estimated_savings, 2),
                "efficiency_suggestion": suggestion
            },
            "summary": {
                "total_network_distance": round(total_distance, 2)
            }
        }


# Kullanım Testi
if __name__ == "__main__":
    # 4 lokasyonlu örnek bir mesafe matrisi (0. indeks depo)
    sample_matrix = [
        [0, 2451, 713, 1018],
        [2451, 0, 1745, 1524],
        [713, 1745, 0, 355],
        [1018, 1524, 355, 0]
    ]

    # 80 paketlik bir teslimat yükü ile optimizasyon başlat
    optimizer = RouteOptimizer()
    result = optimizer.solve(sample_matrix, package_count=80)
    print(result)