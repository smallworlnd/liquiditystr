#!/usr/bin/env python3
import os
import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from publsp.api.app import app as publsp_app

# Create the main FastAPI app
app = FastAPI(
    title="Liquiditystr",
    description="Gateway to the Nostr P2P Lightning liquidity marketplace")

# Mount the publsp API
app.mount("/api", publsp_app)

# Serve static files from the SvelteKit build
app.mount("/static", StaticFiles(directory="build"), name="static")


@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    """
    Serve the SvelteKit frontend for all non-API routes
    """
    # Try to serve the specific file first
    file_path = os.path.join("build", full_path)
    if os.path.isfile(file_path):
        return FileResponse(file_path)

    # Fallback to index.html for SPA routing
    index_path = os.path.join("build", "index.html")
    if os.path.isfile(index_path):
        return FileResponse(index_path)

    # If no build files exist, return a basic message
    return {"message": "Liquiditystr is starting up..."}

if __name__ == "__main__":
    # Get configuration from environment variables
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    workers = int(os.getenv("WORKERS", "1"))

    # Start the server
    uvicorn.run(
        "run_liquiditystr:app",
        host=host,
        port=port,
        workers=workers,
        log_level="info",
        access_log=True,
        reload=False
    )
