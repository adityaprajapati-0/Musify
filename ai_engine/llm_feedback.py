import os
import random
from typing import Dict, List, Tuple

from groq import Groq

DEFAULT_MODEL = os.getenv("GROQ_MODEL", "llama3-8b-8192")
API_TIMEOUT_SECONDS = float(os.getenv("GROQ_TIMEOUT_SECONDS", "8"))

STYLE_INSTRUCTIONS = {
    "strict": "Be direct and demanding, but still constructive.",
    "encouraging": "Be warm, motivating, and supportive.",
    "funny": "Use light humor while still giving practical coaching.",
    "classical": "Use refined, conservatory-style vocal coaching language.",
}

_METRIC_LABELS = {
    "pitch": "pitch control",
    "timing": "rhythm",
    "stability": "tone stability",
}

_OPENERS = {
    "strict": [
        "Direct take:",
        "Straight assessment:",
    ],
    "encouraging": [
        "Great effort today.",
        "Nice progress on this take.",
        "Good work putting this together.",
    ],
    "funny": [
        "Judge mode activated.",
        "Mic check passed. Coach mode on.",
    ],
    "classical": [
        "A thoughtful attempt.",
        "Promising musical intent.",
    ],
}

_CLOSERS = {
    "strict": [
        "Repeat this drill set daily for a week.",
        "Track these targets over your next three takes.",
    ],
    "encouraging": [
        "Keep this up and your next take should jump.",
        "You are close. A few focused reps will move this fast.",
    ],
    "funny": [
        "Run it back and let version two steal the spotlight.",
        "One more focused pass and this gets stage-ready.",
    ],
    "classical": [
        "Sustain this routine and your phrasing will settle beautifully.",
        "Consistent technical focus will quickly refine the performance.",
    ],
}

_PRAISE_BY_METRIC = {
    "pitch": [
        "Your note targeting was the strongest part of this run.",
        "Pitch placement is leading your performance right now.",
    ],
    "timing": [
        "Your pulse tracking was the strongest element.",
        "Rhythmic placement is currently your best asset.",
    ],
    "stability": [
        "Tone steadiness stood out most in this take.",
        "Your sustained tone control was the clear strength.",
    ],
}

_TIPS = {
    "pitch": {
        "low": [
            "Sing the phrase on a single vowel with a piano drone, then re-add lyrics.",
            "Slow to 70% speed and lock each target note before moving on.",
        ],
        "mid": [
            "Isolate interval jumps and repeat them in short two-bar loops.",
            "Use light onset on higher notes and avoid pushing volume upward.",
        ],
        "high": [
            "Refine intonation by recording one line at a time and matching the center of each note.",
        ],
    },
    "timing": {
        "low": [
            "Clap subdivisions with a metronome before singing the line.",
            "Practice the lyric rhythm on consonants only, then add melody back.",
        ],
        "mid": [
            "Loop difficult entries with a click and place each phrase start exactly on beat.",
            "Count in out loud for one bar before every phrase entrance.",
        ],
        "high": [
            "Tighten groove by slightly shortening phrase tails so entries stay crisp.",
        ],
    },
    "stability": {
        "low": [
            "Use 4-second inhale and 6-second sustained notes to steady airflow.",
            "Hold long tones at medium volume and keep jaw and tongue relaxed.",
        ],
        "mid": [
            "Practice even vibrato-free holds, then reintroduce expression gradually.",
            "Keep vowels consistent through each sustained syllable.",
        ],
        "high": [
            "Maintain this support by ending each phrase with controlled breath release.",
        ],
    },
}


def _score(value: float) -> float:
    return max(0.0, min(100.0, float(value)))


def _band(score: float) -> str:
    if score < 60:
        return "low"
    if score < 80:
        return "mid"
    return "high"


def _pick(items: List[str]) -> str:
    if not items:
        return ""
    return random.choice(items)


def _tip_for(metric: str, score: float) -> str:
    metric_tips = _TIPS.get(metric, {})
    return _pick(metric_tips.get(_band(score), []))


def _build_metric_rank(stats: Dict[str, float]) -> List[Tuple[str, float]]:
    ranked = [
        ("pitch", _score(stats.get("pitch_accuracy", 0))),
        ("timing", _score(stats.get("timing_accuracy", 0))),
        ("stability", _score(stats.get("stability_score", 0))),
    ]
    ranked.sort(key=lambda item: item[1])
    return ranked


def local_feedback(
    stats: Dict[str, float],
    song_title: str = "the song",
    artist: str = "the artist",
    judge_style: str = "encouraging",
) -> str:
    style = judge_style.lower().strip() or "encouraging"
    if style not in STYLE_INSTRUCTIONS:
        style = "encouraging"

    pitch = _score(stats.get("pitch_accuracy", 0))
    timing = _score(stats.get("timing_accuracy", 0))
    stability = _score(stats.get("stability_score", 0))
    ranked = _build_metric_rank(stats)

    weakest_metric, weakest_score = ranked[0]
    second_metric, second_score = ranked[1]
    strongest_metric, strongest_score = ranked[-1]

    opener = _pick(_OPENERS.get(style, _OPENERS["encouraging"]))
    praise = _pick(_PRAISE_BY_METRIC.get(strongest_metric, []))
    primary_tip = _tip_for(weakest_metric, weakest_score)
    secondary_tip = (
        _tip_for(second_metric, second_score)
        if second_score < 82.0 and second_metric != weakest_metric
        else ""
    )
    closer = _pick(_CLOSERS.get(style, _CLOSERS["encouraging"]))

    high_note_note = ""
    if bool(stats.get("high_notes_issue", False)) and pitch < 80.0:
        high_note_note = " High notes still look tense; keep volume moderate and lift soft palate instead of pushing."

    lines = [
        f'{opener} On "{song_title}" by {artist}, {praise} ({strongest_score:.1f}%).',
        f"Priority focus: {_METRIC_LABELS[weakest_metric]}. {primary_tip}",
    ]
    if secondary_tip:
        lines.append(
            f"Secondary focus: {_METRIC_LABELS[second_metric]}. {secondary_tip}"
        )
    lines.append(
        f"Scores this take: pitch {pitch:.1f}%, timing {timing:.1f}%, stability {stability:.1f}%.{high_note_note}"
    )
    lines.append(closer)

    return " ".join(part.strip() for part in lines if part).strip()


def get_feedback(
    stats: Dict[str, float],
    song_title: str = "the song",
    artist: str = "the artist",
    judge_style: str = "encouraging",
) -> str:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        return local_feedback(stats, song_title, artist, judge_style)

    style = STYLE_INSTRUCTIONS.get(
        judge_style.lower(),
        STYLE_INSTRUCTIONS["encouraging"],
    )
    prompt = f"""
You are a professional singing competition judge.
Style: {style}

Performance stats:
Pitch accuracy: {stats.get('pitch_accuracy', 0)}%
Timing accuracy: {stats.get('timing_accuracy', 0)}%
Stability score: {stats.get('stability_score', 0)}%
High notes issue: {stats.get('high_notes_issue', False)}

The user sang "{song_title}" by {artist}.
Give natural spoken feedback.
Be honest but motivating.
Mention the strongest area and two concrete next drills.
Keep it under 120 words.
""".strip()

    try:
        client = Groq(api_key=api_key, timeout=API_TIMEOUT_SECONDS)
        completion = client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.85,
        )
        text = completion.choices[0].message.content
        if isinstance(text, str) and text.strip():
            return text.strip()
    except Exception:
        pass

    return local_feedback(stats, song_title, artist, judge_style)
