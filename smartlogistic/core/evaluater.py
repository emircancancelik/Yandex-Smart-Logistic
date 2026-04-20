import os
import pandas as pd
import numpy as np
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from core.predictor import DelayPredictor

class ModelEvaluator:
    def __init__(self, test_data_path: str = "data/test_data.csv"):
        self.test_data_path = test_data_path
        # Mevcut inference modülünü sisteme entegre olarak başlatıyoruz
        self.predictor = DelayPredictor()

    def run_evaluation(self, target_column: str = "actual_delay_min"):
        """
        Test veri setini okur, her satırı JSON payload'una çevirir, 
        tahminleri alır ve gerçek sonuçlarla kıyaslayarak metrikleri hesaplar.
        """
        if not os.path.exists(self.test_data_path):
            raise FileNotFoundError(f"[ERROR] Test verisi bulunamadı: {self.test_data_path}")

        df_test = pd.read_csv(self.test_data_path)
        
        if target_column not in df_test.columns:
            raise ValueError(f"[ERROR] Hedef sütun '{target_column}' test veri setinde yok.")

        actuals = []
        predictions = []

        # Her bir satırı sanki API'den gelen bir istekmiş (payload) gibi simüle et
        for _, row in df_test.iterrows():
            payload_dict = row.to_dict()
            
            # Gerçek değeri kaydet
            actual_delay = payload_dict.pop(target_column)
            actuals.append(actual_delay)
            
            # Predictor'ın kendi preprocessing (One-Hot vb.) mantığından geçirerek tahmin al
            predicted_delay = self.predictor.predict(payload_dict)
            predictions.append(predicted_delay)

        # Metriklerin Hesaplanması
        mae = mean_absolute_error(actuals, predictions)
        mse = mean_squared_error(actuals, predictions)
        rmse = np.sqrt(mse)
        r2 = r2_score(actuals, predictions)

        # Sonuç Raporu
        print("="*40)
        print(" XGBoost Model Performans Metrikleri")
        print("="*40)
        print(f"Test Edilen Kayıt Sayısı : {len(actuals)}")
        print(f"MAE (Ort. Mutlak Hata)   : {mae:.2f} dakika")
        print(f"MSE (Ort. Karesel Hata)  : {mse:.2f}")
        print(f"RMSE (Kök Ort. Kar. Hata): {rmse:.2f} dakika")
        print(f"R² Skoru                 : {r2:.4f}")
        print("="*40)
        
        return {"mae": mae, "mse": mse, "rmse": rmse, "r2": r2}

class RouteXAIEvaluator:
    def __init__(self):
        self.MAX_DELAY_PENALTY = 40.0
        self.MAX_DIST_PENALTY = 30.0
        self.MAX_RISK_PENALTY = 30.0

    def calculate_score(self, delay_minutes: int, distance_km: float, weather_condition: str) -> dict:
        """
        Gelen anlık verilere göre 100 üzerinden açıklanabilir rota güven skoru hesaplar.
        """
        # 1. Gecikme Cezası (Örn: 60 dakika ve üzeri gecikmelerde tam ceza)
        delay_penalty = min(self.MAX_DELAY_PENALTY, round((delay_minutes / 60.0) * self.MAX_DELAY_PENALTY, 2))
        
        # 2. Mesafe Cezası (Her 10 km için 1 puan ceza, max 30)
        dist_penalty = min(self.MAX_DIST_PENALTY, round((distance_km / 10.0) * 1.0, 2))
        
        # 3. Hava Durumu Cezası
        weather_risk_map = {"CLEAR": 0.0, "CLOUDY": 0.2, "RAIN": 0.6, "SNOW": 1.0, "STORM": 1.0}
        risk_factor = weather_risk_map.get(str(weather_condition).upper(), 0.3)
        risk_penalty = round(risk_factor * self.MAX_RISK_PENALTY, 2)
        
        # Nihai Skor
        total_penalty = delay_penalty + dist_penalty + risk_penalty
        final_score = max(0.0, round(100.0 - total_penalty, 2))
        
        # Durum Belirleme
        if final_score >= 80:
            status = "OPTİMAL"
        elif final_score >= 50:
            status = "RİSKLİ"
        else:
            status = "KRİTİK"
            
        return {
            "base_score": 100.0,
            "final_score": final_score,
            "penalties": {"delay": delay_penalty, "distance": dist_penalty, "weather_risk": risk_penalty},
            "explanations": {
                "delay_exp": f"{delay_minutes} dakika ML gecikme tahmini: -{delay_penalty} puan",
                "distance_exp": f"{distance_km:.1f} km toplam rota mesafesi: -{dist_penalty} puan",
                "risk_exp": f"{str(weather_condition).upper()} hava koşulları: -{risk_penalty} puan"
            },
            "status": status
        }
    
if __name__ == "__main__":
    # Test verisini data klasörüne koyduğundan emin ol. (Örn: actual_delay_min sütunu içermeli)
    evaluator = ModelEvaluator(test_data_path="data/test_data.csv")
    evaluator.run_evaluation(target_column="actual_delay_min")