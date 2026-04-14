# Smart Logistics Frontend — Walkthrough

## 🎯 What Was Built

A **premium dark-themed Dispatcher Dashboard** for the Smart Logistics hackathon case. The frontend is a single-page application with 4 views, built using vanilla HTML/CSS/JS with Leaflet.js for maps and Chart.js for analytics.

---

## 📂 File Structure & What Each File Does

```
smart_logistic/
├── smartlogistic/
│   └── api/routes.py          ← [MODIFIED] Added CORS middleware
├── frontend/
│   ├── index.html             ← [NEW] Main SPA — all 4 views
│   ├── css/
│   │   └── style.css          ← [NEW] Design system (700+ lines)
│   └── js/
│       ├── data.js            ← [NEW] CSV data loader & parser
│       ├── api.js             ← [NEW] Backend API communication
│       ├── map.js             ← [NEW] Leaflet map manager
│       ├── graph.js           ← [NEW] SVG network graph animation
│       ├── analytics.js       ← [NEW] Chart.js analytics engine
│       └── app.js             ← [NEW] Main controller & navigation
```

### File-by-File Explanation:

| File | Purpose |
|------|---------|
| **style.css** | Complete design system: dark theme, CSS variables, sidebar, KPI cards, forms, buttons, tables, badges, toast notifications, responsive breakpoints, animations |
| **data.js** | Loads 5 CSV files from `smartlogistic/data/`, parses them, provides KPI calculations, grouping, counting, and coordinate extraction methods |
| **api.js** | Wraps the `POST /api/v1/optimize-route` endpoint. Builds payloads from form data, handles errors, includes health check |
| **map.js** | Initializes Leaflet with dark CARTO tiles centered on Sivas. Plots route polylines and color-coded stop markers (green/yellow/red based on delay) with popup details |
| **graph.js** | Manages the SVG logistics network (NodeA→E). Animates affected edges (red dashed), optimal routes (green), and shows weight changes when penalties are applied |
| **analytics.js** | Renders 4 Chart.js visualizations: delay-by-weather bar, delay-by-traffic bar, vehicle-type doughnut, on-time-rate histogram |
| **app.js** | Main controller: navigation between views, KPI updates, route list rendering, clock, toast notifications, optimization workflow (form → API → graph animation → results) |
| **routes.py** | [Modified] Added `CORSMiddleware` to allow frontend-backend communication |

---

## 🖥️ The 4 Views

### 1. Dashboard
Real-time overview with KPIs, interactive Sivas map, route status list, and weather widget.

![Dashboard View](C:\Users\f\.gemini\antigravity\brain\6e863662-a109-4b87-b97c-11661669b787\dashboard_screenshot.png)

### 2. Route Optimizer
Form to report incidents → sends to ML API → animated graph + delay prediction + dispatcher recommendation.

![Route Optimizer View](C:\Users\f\.gemini\antigravity\brain\6e863662-a109-4b87-b97c-11661669b787\analytics_screenshot.png)

### 3. Analytics
Historical performance charts from CSV data.

![Analytics View](C:\Users\f\.gemini\antigravity\brain\6e863662-a109-4b87-b97c-11661669b787\analytics_screenshot.png)

### 4. All Routes
Complete data table of all 200 routes with metrics.

![All Routes View](C:\Users\f\.gemini\antigravity\brain\6e863662-a109-4b87-b97c-11661669b787\routes_screenshot.png)

---

## 🔌 Backend Integration

The frontend communicates with the backend via a single POST endpoint:

```
POST http://localhost:8000/api/v1/optimize-route
```

**Flow:** Form input → `api.js` builds payload → `fetch()` POST → Response → `graph.js` animates → `app.js` renders results + recommendation

---

## 🚀 How to Run

1. **Start the HTTP server** (from project root):
   ```bash
   python -m http.server 5500
   ```
2. **Open dashboard**: http://localhost:5500/frontend/index.html
3. **Start backend** (optional, for route optimization):
   ```bash
   cd smartlogistic
   python -m api.routes
   ```

---

## ✅ Verification

- All 4 views render correctly ✅
- Map shows real Sivas coordinates from CSV ✅
- KPIs compute from route data ✅
- Charts render from CSV analytics ✅
- Routes table populated ✅
- Toast notification system works ✅
- Navigation + responsive design works ✅
- CORS added to backend ✅
