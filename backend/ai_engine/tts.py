import os
from pathlib import Path

import edge_tts

DEFAULT_VOICE = os.getenv("EDGE_TTS_VOICE", "en-US-GuyNeural")
DEFAULT_RATE = os.getenv("EDGE_TTS_RATE", "+0%")


async def generate_voice(
    text: str,
    output_file: str = "feedback.mp3",
    voice: str = DEFAULT_VOICE,
):
    output_path = Path(output_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    communicate = edge_tts.Communicate(text=text, voice=voice, rate=DEFAULT_RATE)
    await communicate.save(str(output_path))
    return str(output_path)
