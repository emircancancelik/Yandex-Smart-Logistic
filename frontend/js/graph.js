/* =========================================================
   graph.js — Network Graph Visualization
   SVG-based logistics network graph (NodeA → NodeE)
   ========================================================= */

const GraphManager = {
  // Edge mapping: edge ID → svg element IDs
  edgeMap: {
    'NodeA-NodeB': { line: 'edge-AB', weight: 'weight-AB', baseWeight: 15 },
    'NodeB-NodeD': { line: 'edge-BD', weight: 'weight-BD', baseWeight: 20 },
    'NodeA-NodeC': { line: 'edge-AC', weight: 'weight-AC', baseWeight: 25 },
    'NodeC-NodeD': { line: 'edge-CD', weight: 'weight-CD', baseWeight: 10 },
    'NodeD-NodeE': { line: 'edge-DE', weight: 'weight-DE', baseWeight: 30 }
  },

  // Node mapping
  nodeMap: {
    'NodeA': 'node-A',
    'NodeB': 'node-B',
    'NodeC': 'node-C',
    'NodeD': 'node-D',
    'NodeE': 'node-E'
  },

  /** Reset all graph styling to default */
  reset() {
    // Reset edges
    Object.values(this.edgeMap).forEach(edge => {
      const el = document.getElementById(edge.line);
      if (el) {
        el.classList.remove('active', 'affected', 'optimal');
        el.style.stroke = '';
        el.style.strokeWidth = '';
        el.style.strokeDasharray = '';
      }
      const wt = document.getElementById(edge.weight);
      if (wt) {
        wt.textContent = `${edge.baseWeight} min`;
        wt.style.fill = '';
      }
    });

    // Reset nodes
    Object.values(this.nodeMap).forEach(nodeId => {
      const el = document.getElementById(nodeId);
      if (el) {
        el.classList.remove('active', 'affected');
        el.style.fill = '';
        el.style.stroke = '';
      }
    });

    // Reset status badge
    const badge = document.getElementById('graphStatus');
    if (badge) {
      badge.textContent = 'Idle';
      badge.className = 'badge badge-info';
    }
  },

  /** Highlight the affected edge (red, dashed) */
  highlightAffected(edgeKey, penalty) {
    const edge = this.edgeMap[edgeKey];
    if (!edge) return;

    const el = document.getElementById(edge.line);
    if (el) {
      el.classList.add('affected');
    }

    const wt = document.getElementById(edge.weight);
    if (wt) {
      const newWeight = edge.baseWeight + penalty;
      wt.textContent = `${newWeight.toFixed(1)} min`;
      wt.style.fill = '#ef4444';
    }

    // Highlight connected nodes
    const [u, v] = edgeKey.split('-');
    [u, v].forEach(nodeName => {
      const nodeEl = document.getElementById(this.nodeMap[nodeName]);
      if (nodeEl) nodeEl.classList.add('affected');
    });
  },

  /** Highlight the optimal route (green) */
  highlightOptimalRoute(routeNodes) {
    if (!routeNodes || routeNodes.length < 2) return;

    // Highlight nodes
    routeNodes.forEach(nodeName => {
      const nodeEl = document.getElementById(this.nodeMap[nodeName]);
      if (nodeEl) {
        nodeEl.classList.remove('affected');
        nodeEl.classList.add('active');
      }
    });

    // Highlight edges along the path
    for (let i = 0; i < routeNodes.length - 1; i++) {
      const edgeKey = `${routeNodes[i]}-${routeNodes[i + 1]}`;
      const edge = this.edgeMap[edgeKey];
      if (edge) {
        const el = document.getElementById(edge.line);
        if (el) {
          el.classList.remove('affected');
          el.classList.add('optimal');
        }
      }
    }

    // Update status badge
    const badge = document.getElementById('graphStatus');
    if (badge) {
      badge.textContent = 'Optimized';
      badge.className = 'badge badge-success';
    }
  },

  /** Animate the optimization process */
  async animateOptimization(affectedEdge, penalty, optimalRoute) {
    // Step 1: Reset
    this.reset();

    // Update status
    const badge = document.getElementById('graphStatus');
    if (badge) {
      badge.textContent = 'Analyzing...';
      badge.className = 'badge badge-warning';
    }

    // Step 2: Show affected edge (delay 300ms)
    await this.sleep(400);
    this.highlightAffected(affectedEdge, penalty);

    // Step 3: Show calculating state
    if (badge) {
      badge.textContent = 'Recalculating...';
    }
    await this.sleep(600);

    // Step 4: Show optimal route
    this.highlightOptimalRoute(optimalRoute);
  },

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};
