# Smart Logistic

Smart Logistic is a route optimization dashboard for dispatch planning. It uses FastAPI for the backend, an ML model for delay prediction, and a web UI for route analysis and optimization.

## Features

- Route delay prediction
- Stop reordering based on weather, traffic, and delay risk
- Fleet and cost estimation
- Dashboard UI with map and alerts
- Docker support

## Project Structure

- `api/` - FastAPI routes and application entry point
- `core/` - delay prediction and route optimization logic
- `models/` - trained ML model files
- `data/` - dataset files used by the app
- `ui/` - frontend files

## Run Locally

Install dependencies:

```bash
pip install -r requirements.txt
```

Start the backend:

```bash
uvicorn api.routes:app --host 0.0.0.0 --port 8000
```

Open:

```text
http://localhost:8000
```

## Run With Docker

Build the image:

```bash
docker build -t smartlogistic .
```

Run the container:

```bash
docker run --rm -p 8000:8000 smartlogistic
```

Or use Docker Compose:

```bash
docker compose up --build
```

## Notes

- The app serves both the API and the UI from the same FastAPI server.
- The optimization flow depends on the trained model in `models/gb_delay_predictor.pkl`.
