from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import pickle
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import calendar
import json
import os

from utils.api import get_aqi, get_weather_forecast, get_open_meteo_daily

app = FastAPI(title="EcoPulse Pro API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------- CONSTANTS -----------------
CITIES = {
    "Toba Tek Singh": {"lat": 30.9713, "lon": 72.4827},
    "Lahore": {"lat": 31.5497, "lon": 74.3436},
    "Karachi": {"lat": 24.8607, "lon": 67.0011},
    "Islamabad": {"lat": 33.6844, "lon": 73.0479},
    "Rajana": {"lat": 30.8252, "lon": 72.5694},
    "Pirmahal": {"lat": 30.7675, "lon": 72.4347},
    "Kamalia": {"lat": 30.7258, "lon": 72.6447}
}

# ----------------- LOAD MODELS -----------------
rainfall_model = None
daily_model = None
city_encoder = None

@app.on_event("startup")
def load_models():
    global rainfall_model, daily_model, city_encoder
    try:
        if os.path.exists("model/model.pkl"):
            rainfall_model = pickle.load(open("model/model.pkl", "rb"))
        if os.path.exists("model/daily_weather_model.pkl"):
            daily_model = pickle.load(open("model/daily_weather_model.pkl", "rb"))
        if os.path.exists("model/city_encoder.pkl"):
            city_encoder = pickle.load(open("model/city_encoder.pkl", "rb"))
    except Exception as e:
        print(f"Error loading models: {e}")

# ----------------- API ENDPOINTS -----------------

@app.get("/api/cities")
def get_cities():
    return CITIES

@app.get("/api/weather/{city}")
def get_weather(city: str):
    if city not in CITIES:
        raise HTTPException(status_code=404, detail="City not found")
    
    coords = CITIES[city]
    try:
        daily_features = get_open_meteo_daily(coords["lat"], coords["lon"])
        forecast = get_weather_forecast(coords["lat"], coords["lon"])
        
        if "daily" not in daily_features or str(forecast.get("cod")) != "200":
            raise HTTPException(status_code=500, detail="API Connectivity Failure")

        temp_max_today = daily_features["daily"]["temperature_2m_max"][0]
        temp_min_today = daily_features["daily"]["temperature_2m_min"][0]
        wind_speed_today = daily_features["daily"]["wind_speed_10m_max"][0]
        precip_today = daily_features["daily"]["precipitation_sum"][0]
        
        tomorrow = datetime.now() + timedelta(days=1)
        month = tomorrow.month
        month_sin = np.sin(2 * np.pi * month / 12)
        month_cos = np.cos(2 * np.pi * month / 12)
        day_of_year = tomorrow.timetuple().tm_yday
        
        # ML Predictions
        ml_temp_max = None
        ml_temp_min = None
        std_max = 0
        std_min = 0
        
        if daily_model and city_encoder:
            try:
                city_enc = city_encoder.transform([city])[0]
                X_pred = np.array([[city_enc, month_sin, month_cos, day_of_year, temp_max_today, temp_min_today, precip_today, wind_speed_today]])
                
                ml_delta = daily_model.predict(X_pred)[0]
                delta_max, delta_min, _ = ml_delta
                
                preds_max = np.array([tree.predict(X_pred)[0][0] for tree in daily_model.estimators_])
                preds_min = np.array([tree.predict(X_pred)[0][1] for tree in daily_model.estimators_])
                std_max = preds_max.std()
                std_min = preds_min.std()
                
                ml_temp_max = temp_max_today + delta_max
                ml_temp_min = temp_min_today + delta_min
            except Exception as e:
                print(f"ML Prediction error: {e}")
                
        # API Forecast Extraction for Tomorrow
        tomorrow_items = [item for item in forecast["list"] if item["dt_txt"].startswith(tomorrow.strftime("%Y-%m-%d"))]
        api_temp_max = max([item["main"]["temp_max"] for item in tomorrow_items]) if tomorrow_items else None
        condition_desc = tomorrow_items[0]["weather"][0]["main"] if tomorrow_items else "Clear"
        
        # 5-Day Trend Data
        trend_data = [{"time": item["dt_txt"], "temperature": item["main"]["temp"]} for item in forecast["list"]]

        return {
            "ml_prediction": {
                "temp_max": float(round(ml_temp_max, 1)) if ml_temp_max is not None else None,
                "temp_min": float(round(ml_temp_min, 1)) if ml_temp_min is not None else None,
                "std_max": float(round(std_max, 1)),
                "std_min": float(round(std_min, 1)),
                "heatwave_alert": (True if ml_temp_max > 42 else False) if ml_temp_max is not None else False
            },
            "api_forecast": {
                "temp_max": float(api_temp_max) if api_temp_max is not None else None,
                "condition": condition_desc
            },
            "trend": trend_data,
            "today": {
                "temp_max": float(temp_max_today) if temp_max_today is not None else None,
                "temp_min": float(temp_min_today) if temp_min_today is not None else None
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/rainfall/{year}")
def get_rainfall(year: int):
    if not rainfall_model:
        raise HTTPException(status_code=503, detail="Rainfall model not loaded")
        
    months = np.arange(1, 13)
    months_data = pd.DataFrame({
        "year": [year]*12,
        "month_sin": np.sin(2 * np.pi * months / 12),
        "month_cos": np.cos(2 * np.pi * months / 12)
    })
    
    predictions = rainfall_model.predict(months_data)
    predictions = [float(max(0, p)) for p in predictions]
    
    total_rainfall = sum(predictions)
    max_month_idx = np.argmax(predictions)
    
    return {
        "monthly_rainfall": predictions,
        "months": list(calendar.month_abbr)[1:],
        "total_expected": round(total_rainfall, 2),
        "wettest_month": {
            "name": calendar.month_name[max_month_idx + 1],
            "amount": round(predictions[max_month_idx], 2)
        }
    }

@app.get("/api/aqi/{city}")
def get_aqi_data(city: str):
    if city not in CITIES:
        raise HTTPException(status_code=404, detail="City not found")
        
    coords = CITIES[city]
    try:
        data = get_aqi(coords["lat"], coords["lon"])
        if "list" in data:
            aqi_val = data['list'][0]['main']['aqi']
            components = data['list'][0]['components']
            return {
                "aqi": aqi_val,
                "components": components
            }
        else:
            raise HTTPException(status_code=500, detail="Invalid API response for AQI")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/eda/metrics")
def get_metrics():
    try:
        with open("model/metrics.json", "r") as f:
            return json.load(f)
    except Exception:
        return {}

@app.get("/api/eda/features")
def get_feature_importances():
    try:
        with open("model/feature_importances.json", "r") as f:
            return json.load(f)
    except Exception:
        return {}

# ----------------- STATIC FILES -----------------
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/{full_path:path}")
def serve_index(full_path: str):
    if full_path == "" or full_path == "index.html":
        return FileResponse("static/index.html")
    # For any other unmatched route, could return 404, but let's just default to index.html for SPA
    return FileResponse("static/index.html")
