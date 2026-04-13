import networkx as nx
import logging

class RouteOptimizer:
    def __init__(self):
        self.graph = nx.DiGraph()
        self._build_initial_graph()

    def _build_initial_graph(self):
        # A mock logistics network for MVP demonstration
        edges = [
            ("NodeA", "NodeB", 15.0), # Baseline 15 mins
            ("NodeB", "NodeD", 20.0),
            ("NodeA", "NodeC", 25.0),
            ("NodeC", "NodeD", 10.0),
            ("NodeD", "NodeE", 30.0)
        ]
        
        for u, v, weight in edges:
            self.graph.add_edge(u, v, weight=weight, original_weight=weight)
            
        logging.info("[SYSTEM] Logistics Graph initialized with baseline weights.")

    def optimize_route(self, source: str, target: str, affected_edge: str, penalty_minutes: float) -> dict:
        try:
            # 1. Parse the affected edge (e.g., "NodeA-NodeB")
            u, v = affected_edge.split('-')
            
            # 2. Update graph weight dynamically
            if self.graph.has_edge(u, v):
                current_weight = self.graph[u][v]['weight']
                self.graph[u][v]['weight'] = current_weight + penalty_minutes
                
            # 3. Calculate new shortest path using Dijkstra's algorithm
            new_path = nx.shortest_path(self.graph, source=source, target=target, weight='weight')
            new_total_time = nx.shortest_path_length(self.graph, source=source, target=target, weight='weight')
            
            # 4. Rollback the weight to original for future independent requests (Stateless approach)
            if self.graph.has_edge(u, v):
                self.graph[u][v]['weight'] = self.graph[u][v]['original_weight']
                
            return {
                "new_route_nodes": new_path,
                "estimated_total_travel_time": round(new_total_time, 2)
            }
            
        except nx.NetworkXNoPath:
            return {"error": f"No valid path found between {source} and {target}."}
        except Exception as e:
            return {"error": f"Graph optimization failed: {str(e)}"}