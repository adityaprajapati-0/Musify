import requests
import io
import wave
import struct

url = "http://127.0.0.1:8000/judge"

# Create a more valid 1-second silent WAV
buffer = io.BytesIO()
with wave.open(buffer, "wb") as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(16000)
    for _ in range(16000):
        wav.writeframes(struct.pack("<h", 0))
buffer.seek(0)
wav_data = buffer.read()

files = {"file": ("user.wav", wav_data, "audio/wav")}
data = {
    "reference_title": "Test",
    "reference_artist": "Test"
}

try:
    print(f"Sending POST to {url}...")
    response = requests.post(url, files=files, data=data)
    print(f"Status Code: {response.status_code}")
    print(f"Response Body: {response.text}")
except Exception as e:
    print(f"Error: {e}")
