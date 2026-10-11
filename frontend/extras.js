// Logbook, insights, pickup confirmation and CSV export
let LOG = [];
const fmtDate = (iso) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function getJSON(path) {
  const r = await fetch(API_URL + path);
  if (!r.ok) throw new Error("Server returned " + r.status);
  return r.json();
}

async function refreshAll() {
  if (!API_URL) {
    $("logList").innerHTML = '<div class="empty">Deploy the API and set API_URL in app.js to keep a live log.</div>';
    ["fc", "dishRank", "imp"].forEach((id) => ($(id).innerHTML = '<p>Available once the API is connected.</p>'));
    return;
  }
  try {
    const [b, i] = await Promise.all([getJSON("/batches"), getJSON("/insights")]);
    LOG = b.batches; renderLog(); renderInsights(i);
    try { renderCharts(); } catch (e) { /* charts are optional */ }
  } catch (e) {
    $("logList").innerHTML = `<div class="empty err">Could not load the log. ${esc(e.message)}</div>`;
  }
}

function renderLog() {
  if (!LOG.length) { $("logList").innerHTML = '<div class="empty">Sort a batch to start your log.</div>'; return; }
  $("logList").innerHTML = LOG.map((r) => `<article class="entry"><header><b>${fmtDate(r.createdAt)}</b><span>${esc(r.meal || "Meal not set")}</span>${r.dish ? `<span>${esc(r.dish)}</span>` : ""}<span>${r.totalKg} kg</span></header>
    <div class="chips">${r.streams.map((s) => `<span class="chip ${s.status === "done" ? "ok" : ""}" style="--c:${s.color}">${s.icon} ${esc(s.label)}, ${s.kg} kg, ${s.status === "done" ? "handed over" : "pending"}</span>`).join("")}</div></article>`).join("");
}

function renderInsights(i) {
  const fc = Object.entries(i.forecast);
  $("fc").innerHTML = "<h3>Expected waste</h3>" + (fc.length
    ? fc.map(([m, v]) => `<p><b>${esc(m)}:</b> about ${v.kg} kg (from ${v.n} batches)</p>`).join("")
    : "<p>Log at least two batches of the same meal to unlock this.</p>");
  $("dishRank").innerHTML = "<h3>Dishes wasted most</h3>" + (i.dishes.length
    ? i.dishes.map((d) => `<p><b>${esc(d.dish)}:</b> ${d.avg_wasted} kg wasted per batch.${d.suggest !== undefined ? ` Cook about ${d.suggest} kg instead of ${d.cook_now} kg (${d.cut_pct}% less).` : ""}</p>`).join("")
    : "<p>Add a dish name and cooked kg when you log a batch.</p>");
  const im = i.impact, max = Math.max(1, ...Object.values(im.by_stream));
  $("imp").innerHTML = `<h3>Impact so far</h3><p><b>${im.kg_total} kg</b> routed across ${im.batches} batches. <b>${im.pickups_done} of ${im.pickups_total}</b> streams confirmed handed over.</p>
    <div class="bars">${Object.entries(im.by_stream).map(([k, v]) => `<div>${esc(k)}, ${v} kg<i style="width:${Math.round(v / max * 100)}%"></i></div>`).join("")}</div>`;
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest(".mini");
  if (!b) return;
  b.disabled = true;
  try {
    if (API_URL && b.dataset.b) {
      const r = await fetch(API_URL + "/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: b.dataset.b, key: b.dataset.k }) });
      if (!r.ok) throw new Error(r.status);
    }
    b.textContent = "Handed over ✓";
    b.closest(".card").classList.add("done");
    refreshAll();
  } catch (err) { b.disabled = false; b.textContent = "Retry"; }
});

$("csv").onclick = () => {
  const q = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const rows = [["time", "meal", "dish", "students", "stream", "kg", "send_to", "status"]];
  LOG.forEach((r) => r.streams.forEach((s) => rows.push([r.createdAt, r.meal, r.dish, r.headcount, s.label, s.kg, s.destination, s.status])));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([rows.map((x) => x.map(q).join(",")).join("\n")], { type: "text/csv" }));
  a.download = "messloop-log.csv"; a.click();
};
refreshAll();

// Quick-add buttons: each adds a line to the notes, with a default amount to edit
document.querySelectorAll("#quick button").forEach((b) => (b.onclick = () => {
  const n = $("notes");
  n.value += (n.value && !n.value.endsWith("\n") ? "\n" : "") + "1 " + b.dataset.u + " " + b.dataset.t;
  n.focus();
}));

// Free in-browser object detector (TensorFlow.js COCO-SSD). Runs on the laptop, costs nothing, and is only a rough helper.
const GROUP = { banana: "vegetable scraps", apple: "vegetable scraps", orange: "vegetable scraps", broccoli: "vegetable scraps", carrot: "vegetable scraps",
  bottle: "plastic packaging", cup: "plastic packaging", "wine glass": "plastic packaging",
  bowl: "cooked leftovers", sandwich: "cooked leftovers", pizza: "cooked leftovers", "hot dog": "cooked leftovers", donut: "cooked leftovers", cake: "cooked leftovers" };
const loadScript = (src) => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error("load failed")); document.head.appendChild(s); });
let detector = null;
$("detect").onclick = async () => {
  const btn = $("detect"), say = (m) => ($("results").innerHTML = `<div class="empty">${m}</div>`);
  if ($("preview").hidden) { say("Add a photo first, then press this button."); return; }
  btn.disabled = true; btn.textContent = "Loading free detector, first time can be slow…";
  try {
    if (!window.cocoSsd) {
      await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js");
      await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js");
    }
    detector = detector || (await cocoSsd.load());
    const found = await detector.detect($("preview")), counts = {};
    found.forEach((f) => { const g = GROUP[f.class]; if (g) counts[g] = (counts[g] || 0) + 1; });
    const lines = Object.keys(counts);
    if (!lines.length) say("The detector did not recognise any food or packaging here. Use the quick-add buttons instead.");
    else {
      const n = $("notes");
      n.value += (n.value ? "\n" : "") + lines.map((g) => "1 kg " + g).join("\n");
      say("Detected: " + lines.map((g) => counts[g] + " item(s) of " + g).join(", ") + ". Weights are placeholders, so edit the kg in the notes, then press Sort this waste.");
    }
  } catch (e) {
    say("The free detector could not load, probably the connection. Use the quick-add buttons instead.");
  }
  btn.disabled = false; btn.textContent = "Suggest from photo (free, beta)";
};

// Charts, drawn as plain SVG so there is nothing extra to load
function renderCharts() {
  const colors = {}, by = {};
  LOG.forEach((r) => r.streams.forEach((s) => { colors[s.label] = s.color; by[s.label] = (by[s.label] || 0) + Number(s.kg); }));
  const ent = Object.entries(by), tot = ent.reduce((a, [, v]) => a + v, 0), R = 70, C = 2 * Math.PI * R;
  let off = 0;
  $("donut").innerHTML = "<h3>Where the waste goes</h3>" + (tot
    ? `<div class="donut"><svg viewBox="0 0 200 200" role="img" aria-label="Kilograms of waste by stream"><g transform="rotate(-90 100 100)">${ent.map(([k, v]) => {
        const len = v / tot * C, c = `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${colors[k]}" stroke-width="26" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}"/>`;
        off += len; return c; }).join("")}</g><text x="100" y="100" text-anchor="middle" class="dt">${tot.toFixed(1)}</text><text x="100" y="120" text-anchor="middle" class="ds">kg logged</text></svg>
      <ul>${ent.map(([k, v]) => `<li><i style="background:${colors[k]}"></i>${esc(k)} <b>${v.toFixed(1)} kg</b></li>`).join("")}</ul></div>`
    : "<p>Log a batch to see this chart.</p>");
  const pts = LOG.slice(0, 12).reverse(), max = Math.max(1, ...pts.map((p) => Number(p.totalKg)));
  $("trend").innerHTML = "<h3>Waste per batch</h3>" + (pts.length > 1
    ? `<svg viewBox="0 0 320 150" class="trendsvg" role="img" aria-label="Kilograms of waste in each batch">${pts.map((p, i) => {
        const h = Number(p.totalKg) / max * 105, step = 292 / pts.length, w = Math.max(8, step - 8), x = 14 + i * step;
        return `<rect x="${x}" y="${125 - h}" width="${w}" height="${h}" rx="5" style="animation-delay:${i * .06}s"/><text x="${x + w / 2}" y="142" text-anchor="middle">${i + 1}</text>`; }).join("")}<text x="2" y="10">${max.toFixed(1)} kg</text></svg><p>Batches in order, oldest first.</p>`
    : "<p>Log at least two batches to see the trend.</p>");
}
