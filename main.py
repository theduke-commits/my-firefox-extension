"""Serve the Firefox popup using the local Ollama model."""

import asyncio
import subprocess
from typing import Annotated, Literal

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, StringConstraints
from starlette.middleware.trustedhost import TrustedHostMiddleware

OLLAMA_GENERATE_URL = "http://127.0.0.1:11434/api/generate"
MODEL_NAME = "qwen2.5-coder:7b"

app = FastAPI(title="Lokales Backend für den Firefox-Assistenten")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])


class PromptRequest(BaseModel):
    prompt: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    model_name: Literal["qwen2.5-coder:7b"] = MODEL_NAME


class PromptResponse(BaseModel):
    response: str


@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/vram-status")
async def vram_status() -> dict[str, int | float]:
    try:
        result = await asyncio.to_thread(
            subprocess.run,
            [
                "/usr/lib/wsl/lib/nvidia-smi",
                "--query-gpu=memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, "Zeitlimit beim Auslesen des Grafikspeichers erreicht.") from exc
    except (OSError, subprocess.CalledProcessError) as exc:
        raise HTTPException(503, "nvidia-smi konnte den Grafikspeicher nicht auslesen.") from exc

    try:
        used_mb, total_mb = map(int, result.stdout.strip().split(","))
        if total_mb <= 0 or not 0 <= used_mb <= total_mb:
            raise ValueError("Invalid GPU memory figures")
    except ValueError as exc:
        raise HTTPException(502, "nvidia-smi lieferte keine gültigen VRAM-Werte.") from exc

    return {
        "used_mb": used_mb,
        "total_mb": total_mb,
        "percentage": round(used_mb * 100 / total_mb, 3),
    }


async def post_to_ollama(payload: dict[str, object], error_detail: str) -> dict[str, object]:
    try:
        timeout = httpx.Timeout(120, connect=5)
        async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
            result = await client.post(OLLAMA_GENERATE_URL, json=payload)
        result.raise_for_status()
        data = result.json()
        if not isinstance(data, dict):
            raise ValueError("Ollama response is not a JSON object")
        return data
    except httpx.TimeoutException as exc:
        raise HTTPException(504, "Zeitlimit beim Warten auf Ollama erreicht.") from exc
    except httpx.ConnectError as exc:
        raise HTTPException(503, "Der lokale Ollama-Dienst ist nicht erreichbar.") from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(502, error_detail) from exc


@app.post("/generate")
async def generate(body: PromptRequest) -> PromptResponse:
    error_detail = "Ollama konnte den Prompt nicht beantworten."
    data = await post_to_ollama(
        {"model": body.model_name, "prompt": body.prompt, "stream": False},
        error_detail,
    )
    answer = data.get("response")
    if not isinstance(answer, str):
        raise HTTPException(502, error_detail)
    return PromptResponse(response=answer)


@app.post("/vram-clear")
async def clear_vram() -> dict[str, str]:
    data = await post_to_ollama(
        {"model": MODEL_NAME, "prompt": "", "keep_alive": 0, "stream": False},
        "Ollama konnte das Modell nicht entladen.",
    )
    if data.get("done") is not True or data.get("done_reason") != "unload":
        raise HTTPException(502, "Ollama hat das Entladen des Modells nicht bestätigt.")
    return {"message": f"Ollama hat das Entladen von {MODEL_NAME} bestätigt."}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
