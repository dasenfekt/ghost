const STREAM_URL = "https://libretime.bauhaus.fm/_a";
const WAV_URL = "audio-file.wav";

const MIX_RANGE = { minHz: 0, maxHz: 15000 };
const WAV_RANGE = { minHz: 5000, maxHz: 10000 };
const FFT_SIZE = 32768;
const FRAME_INTERVAL_MS = 33;
const LOAD_TIMEOUT_MS = 15000;

const mixCanvas = document.querySelector("#mixSpectrogram");
const wavCanvas = document.querySelector("#wavSpectrogram");
const startButton = document.querySelector("#startButton");
const statusEl = document.querySelector("#status");
const mixCtx = mixCanvas.getContext("2d", { alpha: false });
const wavCtx = wavCanvas.getContext("2d", { alpha: false });

let audioContext = null;
let streamAudio = null;
let streamSource = null;
let wavSource = null;
let mixBus = null;
let streamGain = null;
let wavMixGain = null;
let wavAnalysisGain = null;
let mixAnalyser = null;
let wavAnalyser = null;
let mixFrequencyData = null;
let wavFrequencyData = null;
let animationId = null;
let started = false;
let lastDraw = 0;

resizeCanvases();
paintIdle();
window.addEventListener("resize", () => {
  resizeCanvases();
  paintIdle();
});
startButton.addEventListener("click", () => {
  startFromUserGesture();
});

async function startFromUserGesture() {
  startButton.disabled = true;
  statusEl.hidden = false;
  statusEl.textContent = "Starting...";
  try {
    await start();
    startButton.hidden = true;
    statusEl.hidden = true;
  } catch (error) {
    console.error(error);
    resetAfterFailedStart();
    statusEl.hidden = false;
    statusEl.textContent = error.message || "Could not start audio.";
    startButton.disabled = false;
  }
}

async function start() {
  if (started) return;
  started = true;

  audioContext = await createAudioContext();
  createGraph();
  await Promise.all([connectStream(), connectWav()]);

  mixFrequencyData = new Uint8Array(mixAnalyser.frequencyBinCount);
  wavFrequencyData = new Uint8Array(wavAnalyser.frequencyBinCount);
  clearCanvas(mixCtx, mixCanvas);
  clearCanvas(wavCtx, wavCanvas);
  animationId = requestAnimationFrame(drawFrame);
}

function resetAfterFailedStart() {
  started = false;

  if (animationId) {
    cancelAnimationFrame(animationId);
  }

  if (streamAudio) {
    streamAudio.pause();
    streamAudio.removeAttribute("src");
    streamAudio.load();
  }

  if (wavSource) {
    try {
      wavSource.stop();
    } catch (_) {
      // Source may not have started.
    }
  }

  if (audioContext && audioContext.state !== "closed") {
    audioContext.close();
  }

  audioContext = null;
  streamAudio = null;
  streamSource = null;
  wavSource = null;
  mixBus = null;
  streamGain = null;
  wavMixGain = null;
  wavAnalysisGain = null;
  mixAnalyser = null;
  wavAnalyser = null;
  mixFrequencyData = null;
  wavFrequencyData = null;
  animationId = null;
}

async function createAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("Web Audio is not supported by this browser.");
  }

  const context = new AudioContextClass({ latencyHint: "interactive" });
  if (context.state === "suspended") {
    await context.resume();
  }
  return context;
}

function createGraph() {
  mixBus = audioContext.createGain();
  mixBus.gain.value = 0.9;

  streamGain = audioContext.createGain();
  streamGain.gain.value = 1;

  wavMixGain = audioContext.createGain();
  wavMixGain.gain.value = 1;

  wavAnalysisGain = audioContext.createGain();
  wavAnalysisGain.gain.value = 1;

  mixAnalyser = createAnalyser();
  wavAnalyser = createAnalyser();

  streamGain.connect(mixBus);
  wavMixGain.connect(mixBus);
  wavAnalysisGain.connect(wavAnalyser);
  mixBus.connect(mixAnalyser);
  mixBus.connect(audioContext.destination);
}

function createAnalyser() {
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.minDecibels = -115;
  analyser.maxDecibels = -20;
  analyser.smoothingTimeConstant = 0;
  return analyser;
}

async function connectStream() {
  streamAudio = new Audio();
  streamAudio.crossOrigin = "anonymous";
  streamAudio.src = STREAM_URL;
  streamAudio.preload = "auto";
  streamAudio.loop = false;

  streamSource = audioContext.createMediaElementSource(streamAudio);
  streamSource.connect(streamGain);
  await withTimeout(
    streamAudio.play(),
    LOAD_TIMEOUT_MS,
    "Stream did not start. The stream may be unavailable or blocked by the browser."
  );
}

async function connectWav() {
  const response = await withTimeout(
    fetch(WAV_URL, { cache: "no-store", mode: "cors" }),
    LOAD_TIMEOUT_MS,
    `WAV did not load from ${WAV_URL}.`
  );
  if (!response.ok) {
    throw new Error(`WAV could not be loaded: ${response.status}`);
  }

  const wavBuffer = await audioContext.decodeAudioData(await response.arrayBuffer());
  wavSource = audioContext.createBufferSource();
  wavSource.buffer = wavBuffer;
  wavSource.loop = true;
  wavSource.connect(wavMixGain);
  wavSource.connect(wavAnalysisGain);
  wavSource.start();
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

function drawFrame(now) {
  animationId = requestAnimationFrame(drawFrame);

  if (now - lastDraw < FRAME_INTERVAL_MS) {
    return;
  }

  lastDraw = now;
  mixAnalyser.getByteFrequencyData(mixFrequencyData);
  wavAnalyser.getByteFrequencyData(wavFrequencyData);
  drawSpectrogram(mixCtx, mixCanvas, mixFrequencyData, MIX_RANGE);
  drawSpectrogram(wavCtx, wavCanvas, wavFrequencyData, WAV_RANGE);
}

function drawSpectrogram(ctx, canvas, data, range) {
  const width = canvas.width;
  const height = canvas.height;
  const nyquist = audioContext.sampleRate / 2;
  const minBin = Math.max(0, Math.floor((range.minHz / nyquist) * data.length));
  const maxBin = Math.min(data.length - 1, Math.ceil((range.maxHz / nyquist) * data.length));
  const binSpan = Math.max(1, maxBin - minBin);

  ctx.drawImage(canvas, 1, 0, width - 1, height, 0, 0, width - 1, height);

  for (let y = 0; y < height; y += 1) {
    const offset = Math.floor(((height - 1 - y) / (height - 1)) * binSpan);
    const bin = Math.min(maxBin, minBin + offset);
    ctx.fillStyle = colorForLevel(data[bin]);
    ctx.fillRect(width - 1, y, 1, 1);
  }
}

function colorForLevel(value) {
  const x = value / 255;
  const r = Math.round(4 + 248 * smoothstep(0.48, 1, x));
  const g = Math.round(8 + 215 * smoothstep(0.14, 0.9, x));
  const b = Math.round(16 + 235 * smoothstep(0.02, 0.58, x) - 120 * smoothstep(0.74, 1, x));
  return `rgb(${r}, ${g}, ${Math.max(0, b)})`;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function resizeCanvases() {
  resizeCanvas(mixCanvas);
  resizeCanvas(wavCanvas);
}

function resizeCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
}

function paintIdle() {
  clearCanvas(mixCtx, mixCanvas);
  clearCanvas(wavCtx, wavCanvas);
}

function clearCanvas(ctx, canvas) {
  ctx.fillStyle = "#050607";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}
