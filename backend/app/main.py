
from fastapi import FastAPI

app = FastAPI(
    title="PrivacyMesh API",
    description="Confidential computing for sensitive banking workloads",
    version="0.1.0"
)


@app.get("/")
def home():
    return {
        "message": "PrivacyMesh API is running",
        "status": "success"
    }


@app.get("/health")
def health():
    return {"status": "healthy"}
