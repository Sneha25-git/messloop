// After `sam deploy`, paste the ApiUrl output here (no trailing slash). Leave empty to preview with sample data.
const API_URL = "https://u751777xjf.execute-api.ap-southeast-2.amazonaws.com";

const $ = (id) => document.getElementById(id);
const STREAMS = [["raw_veg_scraps","🥬","#34d399"],["cooked_leftovers","🍛","#fbbf24"],["untouched_surplus","🍱","#fb7185"],["used_cooking_oil","🛢️","#f59e0b"],["starchy_water","💧","#38bdf8"],["packaging","📦","#a78bfa"]];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Hero: waste drops from one bin and splits into streams
(function drawFlow() {
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let h = '<rect x="190" y="18" width="140" height="62" rx="18" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.28)"/><text x="260" y="55" text-anchor="middle" fill="#eaf6f2" font-size="15" font-weight="700">Mixed waste</text>';
  STREAMS.forEach(([k, ic, c], i) => {
    const x = 50 + i * 84, p = `M260 80 C260 220 ${x} 230 ${x} 342`;
    h += `<path d="${p}" fill="none" stroke="${c}" stroke-opacity=".35" stroke-width="2" stroke-dasharray="4 6"/>`;
    if (!calm) for (let j = 0; j < 2; j++) h += `<circle r="6" fill="${c}"><animateMotion dur="3.6s" begin="${(i * .45 + j * 1.8).toFixed(2)}s" repeatCount="indefinite" path="${p}"/></circle>`;
    h += `<circle cx="${x}" cy="372" r="30" fill="${c}" fill-opacity=".16" stroke="${c}"/><text x="${x}" y="381" text-anchor="middle" font-size="26">${ic}</text>`;
  });
  $("flow").innerHTML = h;
})();

// Photo input, resized in the browser so uploads stay small
let imgB64 = null;
const drop = $("drop"), file = $("file");
function loadFile(f) {
  if (!f || !f.type.startsWith("image/")) return;
  const img = new Image();
  img.onload = () => {
    const s = Math.min(1, 1024 / Math.max(img.width, img.height)), cv = document.createElement("canvas");
    cv.width = img.width * s; cv.height = img.height * s;
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    const url = cv.toDataURL("image/jpeg", .82);
    imgB64 = url.split(",")[1];
    $("preview").src = url; $("preview").hidden = false; $("hint").hidden = true;
  };
  img.src = URL.createObjectURL(f);
}
file.onchange = () => loadFile(file.files[0]);
drop.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } };
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => loadFile(e.dataTransfer.files[0]));


function sample() {
  const mk = (key, label, icon, color, kg, h, action, destination, reroute) => ({ key, label, icon, color, kg, items: [], window_hours: h, action, destination, reroute, confidence: .8, deadline: new Date(Date.now() + h * 36e5).toISOString() });
  return { mode: "sample", totalKg: 8.5, windows_verified: false, streams: [
    mk("untouched_surplus","Untouched surplus food","🍱","#fb7185",1.5,2,"Pack in clean containers straight away","Partner NGO or food bank","Biogas or animal feed"),
    mk("cooked_leftovers","Cooked leftovers","🍛","#fbbf24",3,4,"Keep separate from raw scraps and hand over quickly","Biogas unit or animal-feed collector","Compost if the feed pickup is missed"),
    mk("raw_veg_scraps","Raw vegetable scraps","🥬","#34d399",4,24,"Collect in a covered bin, kept apart from cooked food","Compost pit, biogas unit or cattle-feed buyer","Compost pit")] };
}

async function analyze() {
  $("go").disabled = true;
  document.querySelector(".scan").hidden = !imgB64;
  $("results").innerHTML = '<div class="empty">Reading your waste and matching each item to a stream…</div>';
  try {
    let data;
    if (!API_URL) { await sleep(1600); data = sample(); }
    else {
      const r = await fetch(API_URL + "/analyze", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: $("notes").value, image_b64: imgB64, media_type: "image/jpeg", mess: "Demo mess", meal: $("meal").value, dish: $("dishIn").value, headcount: $("head").value, cooked_kg: $("cooked").value }) });
      if (!r.ok) throw new Error("Server returned " + r.status);
      data = await r.json();
    }
    render(data); loadStats(); if (window.refreshAll) refreshAll();
  } catch (e) {
    $("results").innerHTML = `<div class="empty err"><b>Could not sort this waste.</b><br>${esc(e.message)}. Check API_URL in app.js and that the API is deployed.</div>`;
  }
  document.querySelector(".scan").hidden = true;
  $("go").disabled = false;
}
$("go").onclick = analyze;

const C = 2 * Math.PI * 34;
function render(d) {
  if (!d.streams.length) { $("results").innerHTML = '<div class="empty">No items recognised. Photos are only previewed in rules-only mode, so tap the quick-add buttons or type what you have.</div>'; return; }
  const label = d.mode === "ai-vision" ? ["AI vision + rules", "ai"] : d.mode === "sample" ? ["Sample data", ""] : ["Rules only", ""];
  let h = `<div class="top"><span>${d.totalKg} kg in ${d.streams.length} streams</span><span class="badge ${label[1]}">${label[0]}</span></div>`;
  d.streams.forEach((s, i) => {
    h += `<div class="card" style="--c:${s.color};--i:${i}" data-dl="${esc(s.deadline)}" data-win="${s.window_hours}" data-re="${esc(s.reroute)}">
      <div><h3>${s.icon} ${esc(s.label)} <small>${s.kg} kg</small></h3>
      <p><b>Do:</b> ${esc(s.action)}<br><b>Send to:</b> ${esc(s.destination)}<br><b>If missed:</b> ${esc(s.reroute)}</p>${s.tag ? `<span class="tag">${esc(s.tag)}</span>` : ""}<button class="mini" data-b="${esc(d.batchId || "")}" data-k="${esc(s.key)}">Mark handed over</button></div>
      <div class="ringbox"><svg class="ring" viewBox="0 0 84 84"><circle class="trk" cx="42" cy="42" r="34"/><circle class="arc" cx="42" cy="42" r="34" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg><span class="t">--:--</span></div></div>`;
  });
  if (d.note) h += `<div class="top">${esc(d.note)}</div>`;
  $("results").innerHTML = h; tick();
}

function tick() {
  document.querySelectorAll(".card[data-dl]").forEach((c) => {
    const total = c.dataset.win * 36e5, left = new Date(c.dataset.dl) - Date.now(), f = Math.max(0, Math.min(1, left / total));
    c.querySelector(".arc").style.strokeDashoffset = C * (1 - f);
    c.classList.toggle("warn", f <= .5 && f > .2); c.classList.toggle("late", f <= .2);
    const s = Math.max(0, Math.floor(left / 1000)), p = (n) => String(n).padStart(2, "0");
    c.querySelector(".t").textContent = left <= 0 ? "Reroute" : `${p(Math.floor(s / 3600))}:${p(Math.floor(s % 3600 / 60))}:${p(s % 60)}`;
  });
}
setInterval(tick, 1000);

async function loadStats() {
  if (!API_URL) return;
  try {
    const { batches } = await (await fetch(API_URL + "/batches")).json();
    $("stats").hidden = false;
    count($("sBatches"), batches.length);
    count($("sKg"), batches.reduce((a, b) => a + Number(b.totalKg || 0), 0));
  } catch (e) { /* stats are optional */ }
}
function count(el, to) {
  const t0 = performance.now();
  (function step(t) { const k = Math.min(1, (t - t0) / 900); el.textContent = (to * k).toFixed(to % 1 ? 1 : 0); if (k < 1) requestAnimationFrame(step); })(t0);
}
loadStats();
