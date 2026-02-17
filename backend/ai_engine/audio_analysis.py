import os
from typing import Optional

import librosa
import numpy as np
import soundfile as sf


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        return int(raw)
    except (TypeError, ValueError):
        return int(default)


USE_PYIN = os.getenv("AI_USE_PYIN", "0").strip().lower() in {"1", "true", "yes", "on"}
ANALYSIS_SAMPLE_RATE = max(8000, _env_int("AI_ANALYSIS_SAMPLE_RATE", 16000))
TIMING_SAMPLE_RATE = max(8000, _env_int("AI_TIMING_SAMPLE_RATE", 16000))
DEFAULT_PITCH_HOP_LENGTH = max(256, _env_int("AI_PITCH_HOP_LENGTH", 768))
FAST_PITCH_HOP_LENGTH = max(
    DEFAULT_PITCH_HOP_LENGTH,
    _env_int("AI_FAST_PITCH_HOP_LENGTH", 1024),
)


def _is_missing_backend_error(exc: Exception) -> bool:
    cls_name = exc.__class__.__name__.lower()
    module_name = exc.__class__.__module__.lower()
    text = str(exc).lower()
    rep = repr(exc).lower()
    return (
        "nobackenderror" in cls_name
        or ("audioread" in module_name and "backend" in cls_name)
        or "nobackenderror" in text
        or "nobackenderror" in rep
    )


def _load_mono_audio(file_path: str, target_sr: Optional[int] = None):
    try:
        # Try soundfile first (fastest, supports WAV/FLAC)
        audio, sr = sf.read(file_path, dtype="float32")
        if audio.ndim > 1:
            audio = np.mean(audio, axis=1)
        if target_sr and sr != target_sr:
            audio = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
            sr = target_sr
        return audio.astype(np.float32), int(sr)
    except Exception as exc:
        print(f"DEBUG: soundfile.read failed for {file_path}: {exc}")
        # Fallback to librosa (needs ffmpeg for WEBM/MP3)
        try:
            audio, sr = librosa.load(file_path, sr=target_sr, mono=True)
            return audio.astype(np.float32), int(sr)
        except Exception as inner_exc:
            # Check for common missing backend/format issues
            err_msg = str(inner_exc).lower()
            if _is_missing_backend_error(inner_exc) or "sndfile" in err_msg:
                raise RuntimeError(
                    f"Could not read audio file '{os.path.basename(file_path)}'. "
                    "Make sure it is a valid WAV file, or install ffmpeg for other formats."
                ) from inner_exc
            raise


def _moving_average(values: np.ndarray, window: int) -> np.ndarray:
    if values.size == 0:
        return values
    window = max(3, int(window))
    if window % 2 == 0:
        window += 1
    if values.size < window:
        return values.astype(np.float32, copy=True)
    kernel = np.ones(window, dtype=np.float32) / float(window)
    pad = window // 2
    padded = np.pad(values.astype(np.float32, copy=False), (pad, pad), mode="edge")
    return np.convolve(padded, kernel, mode="valid").astype(np.float32, copy=False)


def get_audio_duration(file_path: str) -> float:
    try:
        # Use soundfile info for fast, backend-less duration for WAV/FLAC
        info = sf.info(file_path)
        return float(info.duration)
    except Exception:
        try:
            # Fallback for other formats if ffmpeg is available
            return float(librosa.get_duration(path=file_path))
        except Exception:
            # Final fallback: load it and check length
            audio, sr = _load_mono_audio(file_path)
            return float(librosa.get_duration(y=audio, sr=sr))


def extract_pitch(
    file_path: str,
    hop_length: int = DEFAULT_PITCH_HOP_LENGTH,
    target_sr: Optional[int] = ANALYSIS_SAMPLE_RATE,
) -> np.ndarray:
    audio, sr = _load_mono_audio(file_path, target_sr=target_sr)

    if USE_PYIN:
        try:
            f0, _, _ = librosa.pyin(
                audio,
                sr=sr,
                fmin=librosa.note_to_hz("C2"),
                fmax=librosa.note_to_hz("C6"),
                hop_length=hop_length,
            )
            pitched = f0[np.isfinite(f0)]
            if pitched.size:
                return pitched.astype(np.float32)
        except Exception:
            pass

    pitches, magnitudes = librosa.piptrack(y=audio, sr=sr, hop_length=hop_length)
    if pitches.size == 0:
        return np.array([], dtype=np.float32)

    frame_indices = np.argmax(magnitudes, axis=0)
    frame_positions = np.arange(pitches.shape[1])
    values = pitches[frame_indices, frame_positions]
    voiced = values[values > 0]
    return voiced.astype(np.float32, copy=False)


def calculate_pitch_accuracy(
    reference_pitch: np.ndarray,
    user_pitch: np.ndarray,
    tolerance_hz: float = 20.0,
) -> float:
    if reference_pitch.size == 0 or user_pitch.size == 0:
        return 0.0

    length = min(len(reference_pitch), len(user_pitch))
    diff = np.abs(reference_pitch[:length] - user_pitch[:length])
    correct = np.count_nonzero(diff <= tolerance_hz)
    return round((correct / length) * 100.0, 2)


def _safe_corrcoef(a: np.ndarray, b: np.ndarray) -> float:
    if a.size == 0 or b.size == 0:
        return 0.0

    length = min(len(a), len(b))
    if length < 8:
        return 0.0

    a = a[:length]
    b = b[:length]
    if np.std(a) < 1e-8 or np.std(b) < 1e-8:
        return 0.0

    corr = float(np.corrcoef(a, b)[0, 1])
    if np.isnan(corr):
        return 0.0
    return corr


def calculate_timing_accuracy(
    reference_file: str,
    user_file: str,
    target_sr: int = TIMING_SAMPLE_RATE,
) -> float:
    ref_audio, ref_sr = _load_mono_audio(reference_file, target_sr=target_sr)
    user_audio, user_sr = _load_mono_audio(user_file, target_sr=target_sr)

    ref_onset = librosa.onset.onset_strength(y=ref_audio, sr=ref_sr)
    user_onset = librosa.onset.onset_strength(y=user_audio, sr=user_sr)

    corr = _safe_corrcoef(ref_onset, user_onset)
    corr_score = max(0.0, min(100.0, ((corr + 1.0) / 2.0) * 100.0))

    ref_tempo, _ = librosa.beat.beat_track(y=ref_audio, sr=ref_sr)
    user_tempo, _ = librosa.beat.beat_track(y=user_audio, sr=user_sr)
    if ref_tempo > 0:
        tempo_error = abs(float(user_tempo) - float(ref_tempo)) / float(ref_tempo)
        tempo_score = max(0.0, 100.0 - (tempo_error * 100.0))
    else:
        tempo_score = 0.0

    timing_score = (0.7 * corr_score) + (0.3 * tempo_score)
    return round(max(0.0, min(100.0, timing_score)), 2)


def calculate_stability_score(user_pitch: np.ndarray) -> float:
    if user_pitch.size < 16:
        return 0.0

    voiced = user_pitch[user_pitch > 0]
    if voiced.size < 16:
        return 0.0

    midi = librosa.hz_to_midi(voiced)
    if midi.size < 16:
        return 0.0

    # Measure micro-instability around local contour instead of global range.
    smooth = _moving_average(midi, 7)
    trend = _moving_average(smooth, 31)
    residual = smooth - trend

    mad = float(np.median(np.abs(residual - np.median(residual))))
    deltas = np.abs(np.diff(smooth))
    if deltas.size:
        cutoff = float(np.percentile(deltas, 80))
        core_deltas = deltas[deltas <= cutoff]
        if core_deltas.size == 0:
            core_deltas = deltas
        jitter = float(np.median(core_deltas))
    else:
        jitter = 0.0

    instability = (0.65 * mad) + (0.35 * jitter)
    score = 100.0 * float(np.exp(-2.4 * instability))

    # Downweight ultra-short voiced snippets to avoid inflated scores.
    coverage = min(1.0, float(midi.size) / 60.0)
    score *= coverage

    return round(max(0.0, min(100.0, score)), 2)


def _self_pitch_consistency_score(user_pitch: np.ndarray) -> float:
    if user_pitch.size < 16:
        return 0.0

    voiced = user_pitch[user_pitch > 0]
    if voiced.size < 16:
        return 0.0

    midi = librosa.hz_to_midi(voiced)
    if midi.size < 16:
        return 0.0

    smooth = _moving_average(midi, 5)
    deltas = np.abs(np.diff(smooth))
    if deltas.size == 0:
        return 0.0

    # Penalize erratic jumps while keeping natural melodic movement.
    abrupt_ratio = float(np.mean(deltas > 2.5))
    transition_score = max(0.0, 100.0 - (abrupt_ratio * 220.0))

    cutoff = float(np.percentile(deltas, 70))
    core_deltas = deltas[deltas <= cutoff]
    if core_deltas.size == 0:
        core_deltas = deltas
    micro_jitter = float(np.median(core_deltas))
    jitter_score = 100.0 * float(np.exp(-2.8 * micro_jitter))

    score = (0.6 * transition_score) + (0.4 * jitter_score)
    return round(max(0.0, min(100.0, score)), 2)


def generate_stats(
    user_file: str,
    reference_file: Optional[str] = None,
    fast_mode: bool = False,
) -> dict:
    hop_length = FAST_PITCH_HOP_LENGTH if fast_mode else DEFAULT_PITCH_HOP_LENGTH
    user_pitch = extract_pitch(
        user_file,
        hop_length=hop_length,
        target_sr=ANALYSIS_SAMPLE_RATE,
    )
    stability_score = calculate_stability_score(user_pitch)

    pitch_accuracy = 0.0
    timing_accuracy = 75.0

    if reference_file and os.path.exists(reference_file):
        ref_pitch = extract_pitch(
            reference_file,
            hop_length=hop_length,
            target_sr=ANALYSIS_SAMPLE_RATE,
        )
        pitch_accuracy = calculate_pitch_accuracy(ref_pitch, user_pitch)
        timing_accuracy = calculate_timing_accuracy(
            reference_file,
            user_file,
            target_sr=TIMING_SAMPLE_RATE,
        )
    else:
        pitch_accuracy = _self_pitch_consistency_score(user_pitch)

    pitch_accuracy = round(max(0.0, min(100.0, float(pitch_accuracy))), 2)
    timing_accuracy = round(max(0.0, min(100.0, float(timing_accuracy))), 2)
    stability_score = round(max(0.0, min(100.0, float(stability_score))), 2)

    return {
        "pitch_accuracy": pitch_accuracy,
        "timing_accuracy": timing_accuracy,
        "stability_score": stability_score,
        "high_notes_issue": pitch_accuracy < 80.0,
    }
