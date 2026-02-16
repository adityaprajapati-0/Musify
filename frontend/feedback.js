document.addEventListener("DOMContentLoaded", () => {
  const data = JSON.parse(localStorage.getItem("singingFeedback"));

  if (!data) {
    window.location.href = "/ai.html";
    return;
  }

  renderFeedback(data);
  initCharts(data);
});

function renderFeedback(data) {
  const stats = data.stats || {};
  const avg = Math.round(
    ((stats.pitch_accuracy || 0) +
      (stats.timing_accuracy || 0) +
      (stats.stability_score || 0)) /
      3,
  );
  const scoreEl = document.getElementById("overallScore");
  if (scoreEl) scoreEl.textContent = avg;

  const pVal = document.getElementById("pitchVal");
  if (pVal) pVal.textContent = `${stats.pitch_accuracy || 0}%`;

  const tVal = document.getElementById("timingVal");
  if (tVal) tVal.textContent = `${stats.timing_accuracy || 0}%`;

  const sVal = document.getElementById("stabilityVal");
  if (sVal) sVal.textContent = `${stats.stability_score || 0}%`;

  const referenceNotice =
    data.reference_used === false
      ? `\n\nNote: ${data.reference_warning || "Reference track was unavailable, so this result is based on your recording only."}`
      : "";

  const critiqueEl = document.getElementById("vocalCritique");
  if (critiqueEl) {
    critiqueEl.textContent =
      (data.text ||
        "You have a unique voice! Keep practicing to reach your full potential.") +
      referenceNotice;
  }

  const playBtn = document.getElementById("playAudioBtn");
  const audio = document.getElementById("ttsAudio");
  const userPlayBtn = document.getElementById("playUserAudioBtn");
  const userAudio = document.getElementById("userAudio");

  function toggleAudio(btn, audio, playText, pauseText) {
    const icon = btn.querySelector(".icon");
    const text = btn.querySelector(".text");

    if (audio.paused) {
      document.querySelectorAll("audio").forEach((a) => {
        if (a !== audio) {
          a.pause();
          a.dispatchEvent(new Event("pause"));
        }
      });
      audio.play();
    } else {
      audio.pause();
    }

    audio.onplay = () => {
      if (icon) icon.textContent = "⏸";
      if (text) text.textContent = pauseText;
    };
    audio.onpause = () => {
      if (icon) icon.textContent = "▶";
      if (text) text.textContent = playText;
    };
    audio.onended = () => {
      if (icon) icon.textContent = "▶";
      if (text) text.textContent = playText;
    };
  }

  if (data.audio_base64 && audio && playBtn) {
    audio.src = `data:audio/mp3;base64,${data.audio_base64}`;
    playBtn.onclick = () =>
      toggleAudio(playBtn, audio, "Play Feedback", "Pause Feedback");
  } else if (playBtn) {
    playBtn.parentElement.style.display = "none";
  }

  if (data.userAudio && userAudio && userPlayBtn) {
    userAudio.src = data.userAudio;
    userPlayBtn.onclick = () =>
      toggleAudio(userPlayBtn, userAudio, "Listen Back", "Pause Recording");
  } else if (userPlayBtn) {
    userPlayBtn.parentElement.style.display = "none";
  }
}

function initCharts(data) {
  const stats = data.stats || {};
  const avg = Math.round(
    ((stats.pitch_accuracy || 0) +
      (stats.timing_accuracy || 0) +
      (stats.stability_score || 0)) /
      3,
  );

  const scoreChartCtx = document.getElementById("scoreChart");
  if (scoreChartCtx) {
    new Chart(scoreChartCtx, {
      type: "doughnut",
      data: {
        datasets: [
          {
            data: [avg, 100 - avg],
            backgroundColor: ["#48f3b6", "rgba(255, 255, 255, 0.05)"],
            borderWidth: 0,
            circumference: 270,
            rotation: 225,
          },
        ],
      },
      options: {
        cutout: "85%",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
    });
  }

  const mainChartCtx = document.getElementById("mainChart");
  if (mainChartCtx) {
    new Chart(mainChartCtx, {
      type: "radar",
      data: {
        labels: ["Pitch", "Timing", "Stability", "Tone", "Power"],
        datasets: [
          {
            label: "Performance",
            data: [
              stats.pitch_accuracy || 0,
              stats.timing_accuracy || 0,
              stats.stability_score || 0,
              Math.max((stats.pitch_accuracy || 10) - 10, 0),
              Math.min((stats.timing_accuracy || 0) + 5, 100),
            ],
            backgroundColor: "rgba(0, 210, 255, 0.15)",
            borderColor: "#00d2ff",
            pointBackgroundColor: "#48f3b6",
            pointBorderColor: "#fff",
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            angleLines: { color: "rgba(255, 255, 255, 0.1)" },
            grid: { color: "rgba(255, 255, 255, 0.1)" },
            pointLabels: {
              color: "rgba(255, 255, 255, 0.6)",
              font: { size: 10 },
            },
            ticks: { display: false, stepSize: 20 },
            max: 100,
            min: 0,
          },
        },
        plugins: {
          legend: { display: false },
        },
      },
    });
  }
}
