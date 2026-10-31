/* Original dependency-free presentation code. See NOTICE.txt for rights. */
(function () {
  "use strict";
  const labels = Object.freeze({fixed: "Fixed-time", max_pressure: "Pressure · 1 s", pressure_interval: "Pressure · 10 s", q_seed_7: "Q7", q_seed_19: "Q19", q_seed_31: "Q31"});
  const modeLabels = Object.freeze({green: "Vehicle green", yellow: "Yellow clearance", red: "All-red clearance", walk: "Pedestrian service", ped_clear: "Pedestrian clearance"});
  const columns = ["second", "mode", "stage", "requestedStage", "stageQueues", "stopped", "active", "pending", "arrived", "pedestrianWait", "crossingOccupied"];

  function decodeFrame(row) {
    if (!Array.isArray(row) || row.length !== columns.length) throw new Error("Invalid recorded frame");
    return Object.fromEntries(columns.map((key, i) => [key, row[i]]));
  }
  function validateReplay(data) {
    if (data.schema_version !== 1 || data.horizon_s !== 600 || !Array.isArray(data.frames) || data.frames.length !== 600 || JSON.stringify(data.columns) !== JSON.stringify(columns)) throw new Error("Incomplete recorded run");
    const frames = data.frames.map(decodeFrame);
    for (const [i, f] of frames.entries()) {
      if (f.second !== i || !Object.hasOwn(modeLabels, f.mode) || !Number.isInteger(f.stage) || f.stage < 0 || f.stage > 5 || f.stageQueues.length !== 6 || !f.stageQueues.every(x => Number.isInteger(x) && x >= 0)) throw new Error("Invalid signal or queue evidence");
      for (const key of ["stopped", "active", "pending", "arrived", "pedestrianWait"]) if (!Number.isInteger(f[key]) || f[key] < 0) throw new Error("Invalid recorded count");
      if (i && f.arrived < frames[i - 1].arrived) throw new Error("Arrivals cannot decrease");
    }
    if (frames[599].arrived !== data.summary.arrived_vehicles) throw new Error("Recorded arrivals do not match summary");
    return frames;
  }
  function timelinePoints(frames) {
    const ceiling = Math.max(1, ...frames.map(f => f.stopped));
    return frames.map((f, i) => `${i ? "L" : "M"}${(i / 599 * 1000).toFixed(2)},${(94 - f.stopped / ceiling * 88).toFixed(2)}`).join(" ");
  }
  function stageColor(frame, stage) {
    if (stage !== frame.stage) return "red";
    return frame.mode === "green" ? "green" : frame.mode === "yellow" ? "yellow" : "red";
  }
  if (typeof module !== "undefined" && module.exports) module.exports = {decodeFrame, validateReplay, timelinePoints, stageColor};
  if (typeof document === "undefined") return;
  const $ = id => document.getElementById(id);
  const state = {frames: null, payload: null, index: 0, timer: null, token: 0, playing: false};
  const cache = new Map();
  const decimal = n => Number(n).toFixed(2);
  const node = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  async function getJson(path) {
    const response = await fetch(path, {credentials: "omit"});
    if (!response.ok) throw new Error(`Could not load evidence (${response.status})`);
    return response.json();
  }
  async function renderResults() {
    try {
      const analysis = await getJson("evidence/results.json");
      const test = analysis.methods.filter(row => row.scope === "overall" && row.split === "test");
      if (test.length !== 6 || analysis.counts.usable_runs !== 210) throw new Error("Incomplete result export");
      for (const row of test) {
        const container = node("div", "bar-row");
        const track = node("div", "bar-track");
        const bar = node("div", `bar-fill ${row.method === "q_seed_7" ? "q" : row.method === "max_pressure" ? "pressure" : ""}`);
        bar.style.width = `${row.mean_waiting_s / 210 * 100}%`;
        track.append(bar);
        container.append(node("span", "bar-label", labels[row.method]), track, node("span", "bar-value", decimal(row.mean_waiting_s)));
        $("waiting-chart").append(container);
      }
      $("waiting-chart").setAttribute("aria-label", test.map(r => `${labels[r.method]}: ${decimal(r.mean_waiting_s)} seconds accrued waiting per scheduled vehicle`).join("; "));
      for (const [split, table] of [["test", "regular-table"], ["stress", "stress-table"]]) {
        for (const row of analysis.methods.filter(r => r.scope === "overall" && r.split === split)) {
          const tr = node("tr");
          const label = node("th", "", labels[row.method]); label.scope = "row"; tr.append(label);
          [decimal(row.mean_waiting_s), `${decimal(row.mean_completion_fraction * 100)}%`, `${row.arrived_vehicles.toLocaleString("en")} / ${row.scheduled_vehicles.toLocaleString("en")}`, `${row.active_vehicles_at_end} / ${row.pending_departures_at_end}`].forEach(value => tr.append(node("td", "", value)));
          $(table).querySelector("tbody").append(tr);
        }
      }
    } catch (error) {
      $("waiting-chart").append(node("p", "load-failure", "Interactive chart could not load. Download the case results below to inspect the complete evidence."));
      $("waiting-chart").setAttribute("aria-label", "Result chart unavailable");
    }
  }
  const stageNodes = [];
  for (let i = 0; i < 6; i++) {
    const row = node("div", "stage-row");
    const lamp = node("span", "lamp"); lamp.setAttribute("aria-hidden", "true");
    const name = node("span", "stage-name", `Stage ${i + 1}`);
    const track = node("div", "queue-track"); track.setAttribute("aria-hidden", "true");
    const bar = node("div", "queue-bar"); track.append(bar);
    const count = node("span", "stage-count", "0");
    row.append(lamp, name, track, count); $("stages").append(row);
    stageNodes.push({row, lamp, bar, count});
  }
  function pause() {
    if (state.timer !== null) window.clearInterval(state.timer);
    state.timer = null; state.playing = false;
    $("play").innerHTML = "▶ <span>Play replay</span>";
    $("play").setAttribute("aria-label", "Play recorded replay");
  }
  function renderFrame() {
    if (!state.frames) return;
    const frame = state.frames[state.index];
    const ceiling = state.queueCeiling;
    stageNodes.forEach(({row, lamp, bar, count}, i) => {
      const color = stageColor(frame, i);
      lamp.className = `lamp ${color}`; row.classList.toggle("active", color !== "red");
      row.setAttribute("aria-label", `Stage ${i + 1}, ${color}, incoming queue ${frame.stageQueues[i]}`);
      bar.style.width = `${frame.stageQueues[i] / ceiling * 100}%`;
      count.textContent = frame.stageQueues[i];
    });
    $("mode-label").textContent = modeLabels[frame.mode];
    $("stopped-value").textContent = frame.stopped;
    $("active-value").textContent = frame.active;
    $("pending-value").textContent = frame.pending;
    $("arrived-value").textContent = frame.arrived;
    $("ped-value").textContent = `${frame.pedestrianWait} s`;
    $("crossing-value").textContent = frame.crossingOccupied ? "Crossing occupied" : "Crossing unoccupied";
    $("request-label").textContent = frame.requestedStage === null ? "Controller managed by the common scheduler" : `Policy requested stage ${frame.requestedStage + 1}; actual mode shown at left`;
    $("time-label").textContent = `${frame.second}–${frame.second + 1} / 600 s`;
    $("scrubber").value = String(state.index);
    $("scrubber").setAttribute("aria-valuetext", `Interval ${frame.second} to ${frame.second + 1} seconds; ${frame.stopped} stopped vehicles`);
    const x = state.index / 599 * 1000;
    $("time-marker").setAttribute("x1", x); $("time-marker").setAttribute("x2", x);
  }
  function play() {
    if (!state.frames) return;
    pause();
    if (state.index === 599) state.index = 0;
    state.playing = true;
    $("play").innerHTML = "Ⅱ <span>Pause replay</span>";
    $("play").setAttribute("aria-label", "Pause recorded replay");
    renderFrame();
    state.timer = window.setInterval(() => {
      state.index = Math.min(599, state.index + 1); renderFrame();
      if (state.index === 599) pause();
    }, 1000 / Number($("speed").value));
  }
  async function loadReplay() {
    pause();
    const token = ++state.token;
    const preset = $("preset").value, method = $("controller").value;
    const path = `replays/${preset}-${method}.json`;
    state.frames = null; state.payload = null;
    $("play").disabled = true; $("restart").disabled = true; $("scrubber").disabled = true;
    $("download-replay").removeAttribute("href");
    $("download-replay").setAttribute("aria-disabled", "true");
    $("replay-status").className = "load-status";
    $("replay-status").textContent = "Loading this recorded run…";
    try {
      const data = cache.has(path) ? cache.get(path) : await getJson(path);
      if (token !== state.token) return;
      if (data.preset !== preset || data.method !== method) throw new Error("Recorded case identity mismatch");
      const frames = validateReplay(data);
      cache.set(path, data);
      state.payload = data; state.frames = frames; state.index = 0;
      state.queueCeiling = Math.max(1, ...frames.flatMap(f => f.stageQueues));
      const points = timelinePoints(frames);
      $("queue-line").setAttribute("d", points);
      $("queue-area").setAttribute("d", `${points} L1000,100 L0,100 Z`);
      $("queue-timeline").setAttribute("aria-label", `Recorded stopped vehicles, ${labels[method]}, ${preset.replaceAll("_", " ")}, seed ${data.seed}, 600 seconds. Use the slider to inspect exact counts.`);
      $("case-label").textContent = `${data.split === "stress" ? "Stress" : "Test"} seed ${data.seed}`;
      $("run-wait").textContent = `${decimal(data.summary.waiting_s)} s waiting / scheduled vehicle`;
      $("run-completion").textContent = `${data.summary.arrived_vehicles}/${data.summary.scheduled_vehicles} arrived · ${data.summary.active_vehicles_at_end} active · ${data.summary.pending_departures_at_end} pending`;
      $("download-replay").href = path;
      $("download-replay").removeAttribute("aria-disabled");
      $("replay-status").textContent = `600 recorded intervals loaded · ${labels[method]} · ${preset.replaceAll("_", " ")} · seed ${data.seed}. Playback is paused.`;
      $("play").disabled = false; $("restart").disabled = false; $("scrubber").disabled = false;
      renderFrame();
    } catch (error) {
      if (token !== state.token) return;
      $("replay-status").className = "load-status error";
      $("replay-status").textContent = "This recorded run could not be loaded. Choose another case or reload the page. No synthetic fallback is shown.";
      for (const id of ["stopped-value", "active-value", "pending-value", "arrived-value", "ped-value", "run-wait", "run-completion", "request-label", "crossing-value"]) $(id).textContent = "Unavailable";
      $("queue-line").setAttribute("d", ""); $("queue-area").setAttribute("d", "");
      stageNodes.forEach(({lamp, bar, count, row}) => {lamp.className = "lamp"; bar.style.width = "0"; count.textContent = "—"; row.setAttribute("aria-label", "Recorded stage unavailable");});
      $("mode-label").textContent = "Unavailable";
    }
  }
  $("preset").addEventListener("change", loadReplay);
  $("controller").addEventListener("change", loadReplay);
  $("play").addEventListener("click", () => state.playing ? pause() : play());
  $("restart").addEventListener("click", () => {pause(); state.index = 0; renderFrame();});
  $("scrubber").addEventListener("input", () => {pause(); state.index = Number($("scrubber").value); renderFrame();});
  $("speed").addEventListener("change", () => {if (state.playing) play();});
  document.addEventListener("visibilitychange", () => {if (document.hidden) pause();});
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reducedMotion.matches) $("speed").value = "1";
  reducedMotion.addEventListener("change", () => {pause(); if (reducedMotion.matches) $("speed").value = "1";});
  renderResults(); loadReplay();
})();
