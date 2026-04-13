import pandas as pd
import joblib
import os

class DelayPredictor:
    def __init__(self, model_path="models/gb_delay_predictor.pkl"):
        """Initializes the ML model into memory (Cold-start prevention)."""
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"[ERROR] Model file not found: {model_path}")
        
        self.model = joblib.load(model_path)
        
        # EXACT feature names and order required by the trained XGBoost model
        self.expected_columns = [
            'num_stops', 'total_distance_km', 'planned_duration_min', 
            'temperature_c', 'precipitation_mm', 'wind_speed_kmh', 
            'humidity_pct', 'visibility_km', 'incident_severity', 
            'weather_condition_cloudy', 'weather_condition_fog', 
            'weather_condition_rain', 'weather_condition_snow', 
            'weather_condition_wind', 'traffic_level_high', 
            'traffic_level_low', 'traffic_level_moderate', 
            'vehicle_type_motorcycle', 'vehicle_type_truck', 
            'vehicle_type_van'
        ]

    def predict(self, payload_dict: dict) -> float:
        """Converts JSON payload to a 1-row DataFrame and predicts delay."""
        # 1. Create a 1-row DataFrame filled with 0s, using the exact required columns
        df_encoded = pd.DataFrame(0.0, index=[0], columns=self.expected_columns)
        
        # 2. Map numerical values if they exist in the incoming JSON payload
        for col in payload_dict.keys():
            if col in self.expected_columns:
                df_encoded.at[0, col] = float(payload_dict[col])
                
        # 3. Apply One-Hot Encoding logic for categorical variables
        for category, prefix in [('weather_condition', 'weather_condition_'), 
                                 ('traffic_level', 'traffic_level_'), 
                                 ('vehicle_type', 'vehicle_type_')]:
            val = payload_dict.get(category, "")
            col_name = f"{prefix}{val}"
            if col_name in self.expected_columns:
                df_encoded.at[0, col_name] = 1.0

        # 4. Execute prediction using the exact matrix structure
        prediction = self.model.predict(df_encoded)[0]
        
        # Ensure the delay is never negative
        return max(0.0, float(prediction)) 