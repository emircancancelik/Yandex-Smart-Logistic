import pandas as pd
import json
import os

def generate_js_data():
    print("[SYSTEM] Starting data conversion for UI...")
    
    # 1. Read the raw CSV files
    try:
        df_weather = pd.read_csv('data/weather_observations.csv')
        df_traffic = pd.read_csv('data/traffic_segments.csv')
        df_history = pd.read_csv('data/historical_delay_stats.csv')
    except FileNotFoundError as e:
        print(f"[ERROR] Could not find a CSV file: {e}")
        return

    # 2. Extract unique values safely (Checking if columns exist first)
    weather_conditions = []
    if 'weather_condition' in df_weather.columns:
        weather_conditions = sorted(df_weather['weather_condition'].dropna().unique().tolist())
        
    traffic_levels = []
    if 'traffic_level' in df_traffic.columns:
        traffic_levels = sorted(df_traffic['traffic_level'].dropna().unique().tolist())
    
    # 3. Export Historical Data directly without groupby
    # We take the first 100 rows to keep the JS file lightweight, 
    # letting the frontend do the aggregation via data.js
    history_data = df_history.head(100).to_dict(orient='records')

    # 4. Construct the JavaScript content
    js_content = f"""/* =========================================================
   mock_data.js — Auto-generated Data for Smart Logistics UI
   Run generate_mock_data.py to update this file.
   ========================================================= */

const UIData = {{
    weatherConditions: {json.dumps(weather_conditions, indent=4)},
    trafficLevels: {json.dumps(traffic_levels, indent=4)},
    historicalSummary: {json.dumps(history_data, indent=4)}
}};
"""

    # 5. Save the output file
    output_path = 'ui/js/mock_data.js'
    
    # Ensure directory exists
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(js_content)
        
    print(f"[SUCCESS] Data successfully exported to {output_path}")

if __name__ == "__main__":
    generate_js_data()