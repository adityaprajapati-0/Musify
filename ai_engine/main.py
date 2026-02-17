import base64
import asyncio
import hashlib
import os
import uuid
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import requests
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Request
from fastapi.responses import JSONResponse
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from audio_analysis import generate_stats, get_audio_duration
from llm_feedback import get_feedback, local_feedback
from tts import generate_voice

BASE_DIR = Path(__file__).resolve().parent
TMP_DIR = BASE_DIR / "tmp"
REFERENCE_CACHE_DIR = BASE_DIR / "reference_cache"

MAX_UPLOAD_BYTES = int(os.getenv("AI_MAX_UPLOAD_BYTES", str(12 * 1024 * 1024)))
MAX_AUDIO_SECONDS = float(os.getenv("AI_MAX_AUDIO_SECONDS", "60"))
REFERENCE_TIMEOUT_SECONDS = int(os.getenv("AI_REFERENCE_TIMEOUT_SECONDS", "15"))
LLM_TIMEOUT_SECONDS = float(os.getenv("AI_LLM_TIMEOUT_SECONDS", "10"))
TTS_TIMEOUT_SECONDS = float(os.getenv("AI_TTS_TIMEOUT_SECONDS", "12"))

TMP_DIR.mkdir(parents=True, exist_ok=True)
REFERENCE_CACHE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Musify Singing Judge AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)




def _safe_text(value: str, fallback: str = "Unknown", max_length: int = 120) -> str:
    if not isinstance(value, str):
        return fallback
    trimmed = value.strip()
    if not trimmed:
        return fallback
    return trimmed[:max_length]


def _safe_remove(path: Path):
    try:
        if path and path.exists():
            path.unlink(missing_ok=True)
    except Exception:
        pass


def _is_http_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
        return parsed.scheme in {"http", "https"} and bool(parsed.netloc)
    except Exception:
        return False


async def _save_upload(file: UploadFile, prefix: str = "user") -> Path:
    suffix = Path(file.filename or "").suffix.lower()
    if not suffix or len(suffix) > 10:
        suffix = ".wav"

    target = TMP_DIR / f"{prefix}_{uuid.uuid4().hex}{suffix}"
    total = 0

    try:
        with target.open("wb") as out_file:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Audio file exceeds {MAX_UPLOAD_BYTES} bytes.",
                    )
                out_file.write(chunk)
    except HTTPException:
        _safe_remove(target)
        raise
    except Exception as exc:
        _safe_remove(target)
        raise HTTPException(status_code=400, detail=f"Upload failed: {exc}") from exc
    finally:
        await file.close()

    if total == 0:
        _safe_remove(target)
        raise HTTPException(status_code=400, detail="Uploaded audio is empty.")

    return target


def _validate_duration(file_path: Path, label: str):
    try:
        duration = get_audio_duration(str(file_path))
    except Exception as exc:
        message = str(exc).strip() or f"Could not read {label} audio."
        raise HTTPException(status_code=400, detail=message) from exc
    if duration <= 0:
        raise HTTPException(status_code=400, detail=f"Could not read {label} audio.")
    if duration > MAX_AUDIO_SECONDS:
        raise HTTPException(
            status_code=413,
            detail=f"{label} audio exceeds {int(MAX_AUDIO_SECONDS)} seconds.",
        )


def _download_reference(reference_url: str) -> Path:
    url = reference_url.strip()
    if not _is_http_url(url):
        raise HTTPException(status_code=400, detail="Invalid reference URL.")

    parsed = urlparse(url)
    suffix = Path(parsed.path).suffix.lower()
    if not suffix or len(suffix) > 10:
        suffix = ".audio"

    cache_key = hashlib.sha256(url.encode("utf-8")).hexdigest()
    target = REFERENCE_CACHE_DIR / f"{cache_key}{suffix}"
    partial = REFERENCE_CACHE_DIR / f"{cache_key}{suffix}.part"

    if target.exists() and target.stat().st_size > 0:
        return target

    try:
        response = requests.get(
            url,
            timeout=REFERENCE_TIMEOUT_SECONDS,
            stream=True,
            headers={"User-Agent": "Musify-AI/1.0"},
        )
        response.raise_for_status()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to download reference track: {exc}",
        ) from exc

    total = 0
    try:
        with partial.open("wb") as out_file:
            for chunk in response.iter_content(chunk_size=8192):
                if not chunk:
                    continue
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Reference track exceeds {MAX_UPLOAD_BYTES} bytes.",
                    )
                out_file.write(chunk)
        if total == 0:
            raise HTTPException(status_code=502, detail="Reference track is empty.")
        partial.replace(target)
    finally:
        _safe_remove(partial)

    return target


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback
    print(f"CRITICAL ERROR: {exc}")
    print(traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"error": str(exc), "traceback": traceback.format_exc()},
    )

@app.middleware("http")
async def log_requests(request: Request, call_next):
    print(f"Incoming request: {request.method} {request.url.path}")
    response = await call_next(request)
    print(f"Response status: {response.status_code} for {request.url.path}")
    return response

@app.on_event("startup")
async def startup_event():
    print("Registered routes:")
    for route in app.routes:
        if hasattr(route, "path"):
            print(f"  {route.path} {getattr(route, 'methods', [])}")

@app.get("/health")
async def health():
    return {"ok": True, "service": "musify-singing-judge"}


@app.post("/judge")
async def judge_song(
    file: UploadFile = File(...),
    reference_file: Optional[UploadFile] = File(default=None),
    reference_url: str = Form(default=""),
    reference_title: str = Form(default="Unknown"),
    reference_artist: str = Form(default="Unknown"),
    judge_style: str = Form(default="encouraging"),
):
    user_file_path = await _save_upload(file, prefix="user")
    reference_file_path = None
    reference_file_is_temp = False
    reference_warning = ""
    output_audio_path = None

    safe_title = _safe_text(reference_title)
    safe_artist = _safe_text(reference_artist)
    safe_style = _safe_text(judge_style, fallback="encouraging", max_length=30).lower()

    try:
        _validate_duration(user_file_path, "User")

        if reference_file is not None and (reference_file.filename or "").strip():
            try:
                reference_file_path = await _save_upload(reference_file, prefix="reference")
                reference_file_is_temp = True
                _validate_duration(reference_file_path, "Reference")
            except HTTPException as exc:
                reference_warning = str(exc.detail) if exc.detail else "Reference track unavailable."
                print(f"Reference upload skipped: {reference_warning}")
                if reference_file_path and reference_file_is_temp:
                    _safe_remove(reference_file_path)
                reference_file_path = None
                reference_file_is_temp = False
            except Exception as exc:
                reference_warning = str(exc).strip() or "Reference track unavailable."
                print(f"Reference upload skipped: {reference_warning}")
                if reference_file_path and reference_file_is_temp:
                    _safe_remove(reference_file_path)
                reference_file_path = None
                reference_file_is_temp = False
        elif reference_url and reference_url != "undefined":
            try:
                reference_file_path = await run_in_threadpool(
                    _download_reference,
                    reference_url,
                )
                _validate_duration(reference_file_path, "Reference")
            except HTTPException as exc:
                reference_warning = str(exc.detail) if exc.detail else "Reference track unavailable."
                print(f"Reference skipped: {reference_warning}")
                reference_file_path = None
            except Exception as exc:
                reference_warning = str(exc).strip() or "Reference track unavailable."
                print(f"Reference skipped: {reference_warning}")
                reference_file_path = None

        try:
            stats = await run_in_threadpool(
                generate_stats,
                str(user_file_path),
                str(reference_file_path) if reference_file_path else None,
            )
        except Exception as exc:
            if reference_file_path:
                reference_warning = (
                    reference_warning
                    or str(exc).strip()
                    or "Reference comparison unavailable."
                )
                print(f"Reference comparison failed; retrying without reference: {reference_warning}")
                reference_file_path = None
                try:
                    stats = await run_in_threadpool(
                        generate_stats,
                        str(user_file_path),
                        None,
                    )
                except Exception as inner_exc:
                    message = str(inner_exc).strip() or "Could not process uploaded audio."
                    raise HTTPException(status_code=400, detail=message) from inner_exc
            else:
                message = str(exc).strip() or "Could not process uploaded audio."
                raise HTTPException(status_code=400, detail=message) from exc

        try:
            feedback_text = await asyncio.wait_for(
                run_in_threadpool(
                    get_feedback,
                    stats,
                    safe_title,
                    safe_artist,
                    safe_style,
                ),
                timeout=LLM_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            feedback_text = local_feedback(
                stats,
                safe_title,
                safe_artist,
                safe_style,
            )

        audio_b64 = ""
        output_audio_path = TMP_DIR / f"feedback_{uuid.uuid4().hex}.mp3"
        try:
            await asyncio.wait_for(
                generate_voice(feedback_text, str(output_audio_path)),
                timeout=TTS_TIMEOUT_SECONDS,
            )
            with output_audio_path.open("rb") as audio_file:
                audio_b64 = base64.b64encode(audio_file.read()).decode("utf-8")
        except (asyncio.TimeoutError, Exception):
            audio_b64 = ""

        return {
            "stats": stats,
            "text": feedback_text,
            "audio_base64": audio_b64,
            "reference_used": bool(reference_file_path),
            "reference_warning": reference_warning,
        }
    finally:
        _safe_remove(user_file_path)
        if reference_file_path and reference_file_is_temp:
            _safe_remove(reference_file_path)
        if output_audio_path:
            _safe_remove(output_audio_path)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
