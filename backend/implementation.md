# Singing Judge AI - Implementation Guide

## Overview

This system evaluates a user's singing performance and provides spoken AI feedback.

### Flow

1. User records singing (frontend).
2. Audio is sent to the Python backend.
3. Backend extracts performance stats.
4. Stats are sent to the Groq API.
5. Groq generates judge-style feedback.
6. Text is converted to speech (TTS).
7. Voice response is returned to frontend.

---

## System Architecture

```text
Frontend (React / HTML)
        v
FastAPI Backend (Python)
        v
Audio Analysis (librosa / crepe)
        v
Performance Stats JSON
        v
Groq API (LLM Feedback)
        v
Edge-TTS (Voice Generation)
        v
MP3 Response -> Frontend Playback
```

---

## Backend Setup

### 1) Install Dependencies

```bash
pip install fastapi uvicorn librosa numpy soundfile groq edge-tts crepe
```

---

## Audio Analysis Module

`audio_analysis.py`

```python
import librosa
import numpy as np


def extract_pitch(file_path):
    y, sr = librosa.load(file_path)
    pitches, magnitudes = librosa.piptrack(y=y, sr=sr)

    pitch_values = []

    for i in range(pitches.shape[1]):
        index = magnitudes[:, i].argmax()
        pitch = pitches[index, i]
        if pitch > 0:
            pitch_values.append(pitch)

    return np.array(pitch_values)


def calculate_accuracy(reference, user):
    min_length = min(len(reference), len(user))
    reference = reference[:min_length]
    user = user[:min_length]

    difference = np.abs(reference - user)
    tolerance = 20  # Hz

    correct = np.sum(difference < tolerance)
    accuracy = (correct / min_length) * 100

    return round(accuracy, 2)
```

---

## Generate Performance Stats

```python
def generate_stats(reference_file, user_file):
    ref_pitch = extract_pitch(reference_file)
    user_pitch = extract_pitch(user_file)

    pitch_accuracy = calculate_accuracy(ref_pitch, user_pitch)

    stability_score = 100 - np.std(user_pitch)

    return {
        "pitch_accuracy": pitch_accuracy,
        "timing_accuracy": 75,  # placeholder (add beat tracking later)
        "stability_score": round(stability_score, 2),
        "high_notes_issue": pitch_accuracy < 80,
    }
```

---

## Groq Integration

### Set API key

```bash
export GROQ_API_KEY="your_key_here"
```

`llm_feedback.py`

```python
from groq import Groq

client = Groq()


def get_feedback(stats):
    prompt = f"""
You are a professional singing competition judge.

Performance stats:
Pitch accuracy: {stats['pitch_accuracy']}%
Timing accuracy: {stats['timing_accuracy']}%
Stability score: {stats['stability_score']}%
High notes issue: {stats['high_notes_issue']}

Give natural spoken-style feedback.
Be honest but motivating.
Keep it under 120 words.
"""

    completion = client.chat.completions.create(
        model="llama3-8b-8192",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
    )

    return completion.choices[0].message.content
```

---

## Text-to-Speech Module

`tts.py`

```python
import edge_tts


async def generate_voice(text):
    communicate = edge_tts.Communicate(text, "en-US-GuyNeural")
    await communicate.save("feedback.mp3")
```

---

## FastAPI Backend

`main.py`

```python
from fastapi import FastAPI, UploadFile, File
import shutil
from audio_analysis import generate_stats
from llm_feedback import get_feedback
from tts import generate_voice

app = FastAPI()


@app.post("/judge")
async def judge_song(file: UploadFile = File(...)):
    with open("user.wav", "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    stats = generate_stats("reference.wav", "user.wav")
    feedback_text = get_feedback(stats)
    await generate_voice(feedback_text)

    return {"stats": stats, "audio_file": "feedback.mp3"}
```

---

## Frontend Recording Example

```javascript
navigator.mediaDevices.getUserMedia({ audio: true })
  .then((stream) => {
    const recorder = new MediaRecorder(stream);
    let chunks = [];

    recorder.ondataavailable = (e) => chunks.push(e.data);

    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/wav" });

      const formData = new FormData();
      formData.append("file", blob);

      const response = await fetch("/judge", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      const audio = new Audio(result.audio_file);
      audio.play();
    };

    recorder.start();
  });
```

---

## Advanced Improvements

### Add Beat Detection

```python
tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
```

Compare tempo alignment.

### Use CREPE (Better Pitch Detection)

```python
import crepe
time, frequency, confidence, activation = crepe.predict(audio, sr)
```

More accurate than `piptrack`.

### Add Judge Personalities

Modify Groq prompt:

- Strict Judge
- Encouraging Coach
- Funny Host
- Classical Guru

---

## Production Considerations

- Store audio in a temp directory.
- Delete files after processing.
- Add async/background processing for scale.
- Limit audio length (for example, 60 seconds max).
- Cache reference pitch data.

---

## Final Result

User sings ->
System analyzes scientifically ->
Groq turns stats into human judgment ->
AI speaks feedback back to user.

You now have:

- AI Singing Judge
- LLM-powered feedback
- Voice-based response
- Fully scalable architecture
