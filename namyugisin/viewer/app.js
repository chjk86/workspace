/* 남유기신 지식그래프 뷰어
 * 데이터: data/data.js (scripts/build_data.py 가 생성) → window.NAMYU_DATA = {visits, letters, graph}
 */
(function () {
  "use strict";

  const DATA = window.NAMYU_DATA;
  if (!DATA) {
    document.body.innerHTML = "<p style='padding:20px'>data/data.js 를 찾지 못했습니다. <code>python3 scripts/build_data.py</code> 를 먼저 실행하세요.</p>";
    return;
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s)<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const fmtDate = (iso) => {
    if (!iso) return "날짜 미상";
    const [y, m, d] = iso.split("-").map(Number);
    const wd = "일월화수목금토"[new Date(y, m - 1, d).getDay()];
    return `${y}년 ${m}월 ${d}일 (${wd})`;
  };

  /* ---------------- 탭 ---------------- */
  const tabs = document.querySelectorAll(".tabs button");
  let graphReady = false;
  function showTab(name) {
    tabs.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("active", s.id === "tab-" + name));
    if (name === "map") map.invalidateSize();
    if (name === "graph" && !graphReady) { initGraph(); graphReady = true; }
    try { history.replaceState(null, "", "#" + name); } catch (e) { /* file:// 등 */ }
  }
  tabs.forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  /* ---------------- 지도 ---------------- */
  const visits = DATA.visits;
  const located = visits.filter((v) => v.lat != null && v.lng != null);

  const map = L.map("map", { zoomControl: true, preferCanvas: false });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(map);

  // 같은 장소(이름+좌표)는 마커 하나로 묶는다
  const placeKey = (v) => `${v.place}|${v.lat}|${v.lng}`;
  const places = new Map();
  located.forEach((v) => {
    const k = placeKey(v);
    if (!places.has(k)) places.set(k, { key: k, name: v.place, lat: v.lat, lng: v.lng, visits: [] });
    places.get(k).visits.push(v);
  });

  function popupHtml(p) {
    const first = p.visits[0];
    const info = p.visits.find((v) => v.evidence || v.note || v.existence) || first;
    const dates = p.visits.map((v) => `${esc(v.dateLabel)}${v.stay ? ' <span class="tag stay">유숙</span>' : ""}${v.coordSource === "inherited" ? ' <span class="tag">좌표 이어받음</span>' : ""}`).join("<br>");
    return `<h3>${esc(p.name)}</h3>
      <div class="muted">${esc(info.modernAddress)}</div>
      <div style="margin:6px 0">${dates}</div>
      ${info.existence ? `<div>현존 여부: <b>${esc(info.existence)}</b></div>` : ""}
      ${info.certainty ? `<div>비정 확실도: ${esc(info.certainty)}</div>` : ""}
      ${info.evidence ? `<div style="margin-top:4px"><b>비정근거</b> ${linkify(info.evidence)}</div>` : ""}
      ${info.note ? `<div style="margin-top:4px"><b>비고</b> ${linkify(info.note)}</div>` : ""}`;
  }

  const markers = new Map();
  places.forEach((p) => {
    const stay = p.visits.some((v) => v.stay);
    const m = L.circleMarker([p.lat, p.lng], baseStyle(stay)).bindPopup(popupHtml(p), { maxWidth: 320 });
    m.bindTooltip(p.name, { permanent: false, direction: "right", className: "stop-label", offset: [6, 0] });
    m.addTo(map);
    m._stay = stay;
    markers.set(p.key, m);
  });
  function baseStyle(stay) {
    return stay
      ? { radius: 7, color: "#fff", weight: 2, fillColor: "#8c2f1f", fillOpacity: 1 }
      : { radius: 5, color: "#2f5d8c", weight: 2, fillColor: "#fff", fillOpacity: 1 };
  }

  // 경로: 시트 행 순서대로, 연속된 같은 좌표는 하나로
  function pathOf(list) {
    const pts = [];
    list.forEach((v) => {
      const last = pts[pts.length - 1];
      if (!last || last[0] !== v.lat || last[1] !== v.lng) pts.push([v.lat, v.lng]);
    });
    return pts;
  }
  const fullPath = pathOf(located);
  const routeAll = L.polyline(fullPath, { color: "#2f5d8c", weight: 3, opacity: 0.75 }).addTo(map);
  const routePast = L.polyline([], { color: "#2f5d8c", weight: 2, opacity: 0.25, dashArray: "4 6" }).addTo(map);
  const routeDay = L.polyline([], { color: "#c0392b", weight: 5, opacity: 0.9 }).addTo(map);
  map.fitBounds(routeAll.getBounds(), { padding: [30, 30] });

  /* ---------------- 타임라인 ---------------- */
  const days = [...new Set(visits.map((v) => v.date).filter(Boolean))].sort();
  const timeline = document.getElementById("timeline");
  const slider = document.getElementById("day");
  const dayLabel = document.getElementById("daylabel");
  slider.max = String(days.length - 1);

  const byDay = new Map();
  visits.forEach((v) => {
    const k = v.date || "unknown";
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(v);
  });
  const dayOrder = [...days, ...(byDay.has("unknown") ? ["unknown"] : [])];

  const stopEls = new Map();
  dayOrder.forEach((d) => {
    const head = document.createElement("li");
    head.className = "day";
    head.textContent = d === "unknown" ? "날짜 미상" : `${fmtDate(d)} · ${days.indexOf(d) + 1}일차`;
    head.dataset.day = d;
    if (d !== "unknown") head.addEventListener("click", () => selectDay(days.indexOf(d)));
    timeline.appendChild(head);
    byDay.get(d).forEach((v) => {
      const li = document.createElement("li");
      const hasCoord = v.lat != null;
      li.className = "stop" + (v.stay ? " stay" : "") + (hasCoord ? "" : " nocoord");
      li.innerHTML = `<span class="n">${esc(v.orderLabel)}</span>
        <span class="name">${esc(v.place)}</span>${v.stay ? '<span class="tag stay">유숙</span>' : ""}${v.existence ? `<span class="tag">${esc(v.existence)}</span>` : ""}
        <div class="meta">${hasCoord ? esc(v.modernAddress) : "좌표 미상"}</div>`;
      li.addEventListener("click", () => focusVisit(v));
      timeline.appendChild(li);
      stopEls.set(v.id, li);
    });
  });

  function focusVisit(v) {
    stopEls.forEach((el) => el.classList.remove("sel"));
    stopEls.get(v.id)?.classList.add("sel");
    if (v.lat == null) return;
    const m = markers.get(placeKey(v));
    map.setView([v.lat, v.lng], Math.max(map.getZoom(), 12), { animate: true });
    m?.openPopup();
  }

  function resetMarkers() {
    markers.forEach((m) => { m.setStyle({ ...baseStyle(m._stay), opacity: 1, fillOpacity: 1 }); m.closeTooltip(); });
  }

  let current = -1;
  function selectDay(i) {
    current = i;
    slider.value = String(i);
    const d = days[i];
    const today = located.filter((v) => v.date === d);
    const before = located.filter((v) => v.date && v.date < d);
    const prev = before[before.length - 1];
    const seg = pathOf(prev ? [prev, ...today] : today);
    routeAll.setStyle({ opacity: 0.12 });
    routePast.setLatLngs(pathOf(before));
    routeDay.setLatLngs(seg);
    const todayKeys = new Set(today.map(placeKey));
    markers.forEach((m, k) => {
      const on = todayKeys.has(k);
      m.setStyle({ ...baseStyle(m._stay), opacity: on ? 1 : 0.25, fillOpacity: on ? 1 : 0.25 });
      if (on) m.openTooltip(); else m.closeTooltip();
    });
    const all = byDay.get(d) || [];
    const stay = all.filter((v) => v.stay).map((v) => v.place);
    dayLabel.innerHTML = `${esc(fmtDate(d))} · ${i + 1}일차 <span class="muted" style="font-weight:400">— ${all.length}곳${stay.length ? `, ${esc(stay[stay.length - 1])} 유숙` : ""}</span>`;
    if (seg.length === 1) map.setView(seg[0], 12);
    else if (seg.length > 1) map.fitBounds(L.latLngBounds(seg), { padding: [60, 60], maxZoom: 13 });
    const head = timeline.querySelector(`.day[data-day="${d}"]`);
    if (head) timeline.scrollTop = head.offsetTop - timeline.offsetTop;
  }

  function showAll() {
    stopPlay();
    current = -1;
    routeAll.setStyle({ opacity: 0.75 });
    routePast.setLatLngs([]);
    routeDay.setLatLngs([]);
    resetMarkers();
    dayLabel.textContent = `전체 여정 · ${days[0]} ~ ${days[days.length - 1]} (${days.length}일, 좌표 있는 지점 ${located.length}/${visits.length})`;
    map.fitBounds(routeAll.getBounds(), { padding: [30, 30] });
  }

  slider.addEventListener("input", () => { stopPlay(); selectDay(Number(slider.value)); });
  document.getElementById("all").addEventListener("click", showAll);

  let timer = null;
  const playBtn = document.getElementById("play");
  function stopPlay() { if (timer) { clearInterval(timer); timer = null; playBtn.textContent = "▶ 재생"; } }
  playBtn.addEventListener("click", () => {
    if (timer) return stopPlay();
    playBtn.textContent = "❚❚ 멈춤";
    if (current < 0 || current >= days.length - 1) selectDay(0);
    timer = setInterval(() => {
      if (current >= days.length - 1) return stopPlay();
      selectDay(current + 1);
    }, 1600);
  });
  document.addEventListener("keydown", (e) => {
    if (!document.getElementById("tab-map").classList.contains("active")) return;
    if (e.target.tagName === "INPUT" && e.target.type !== "range") return;
    if (e.key === "ArrowRight") { e.preventDefault(); stopPlay(); selectDay(Math.min(days.length - 1, current + 1)); }
    if (e.key === "ArrowLeft") { e.preventDefault(); stopPlay(); selectDay(Math.max(0, current - 1)); }
    if (e.key === "Escape") showAll();
  });
  showAll();

  /* ---------------- 연재 목록 ---------------- */
  document.getElementById("letters").innerHTML = (DATA.letters || [])
    .map((l) => `<tr><td>${esc(l.published)}</td><td>${esc(l.no)}</td><td>${esc(l.subhead)}</td><td class="muted">${esc(l.note)}</td></tr>`)
    .join("");

  /* ---------------- 관계 네트워크 ---------------- */
  const GROUPS = {
    person: { label: "인물", color: "#8c2f1f", shape: "dot", size: 18 },
    place: { label: "장소", color: "#2f5d8c", shape: "dot", size: 9 },
    work: { label: "문헌", color: "#b7791f", shape: "box" },
    org: { label: "기관", color: "#4a7c59", shape: "diamond", size: 14 },
  };
  const TRIP = new Set(["방문", "유숙"]);

  function initGraph() {
    const g = DATA.graph;
    const nodes = new vis.DataSet(g.nodes.map((n) => ({
      id: n.id, label: n.label, group: n.group,
      title: `${GROUPS[n.group]?.label || n.group}: ${n.label}`,
      ...(n.id === "P:정인보" ? { size: 30, font: { size: 18, bold: true } } : {}),
    })));
    const edges = new vis.DataSet(g.edges.map((e, i) => ({
      id: i, from: e.from, to: e.to, rel: e.label, src: e.source, date: e.date,
      label: TRIP.has(e.label) ? undefined : e.label,
      title: [e.label, e.date, e.source].filter(Boolean).join(" · "),
      color: TRIP.has(e.label) ? { color: e.label === "유숙" ? "#d9a79c" : "#c9d3de" } : { color: "#555" },
      width: TRIP.has(e.label) ? 1 : 1.6,
      dashes: /확인 필요/.test(e.label),
      arrows: "to",
    })));

    const groupOn = Object.fromEntries(Object.keys(GROUPS).map((k) => [k, true]));
    const hideTrip = document.getElementById("hideTrip");
    // 여정 관계를 숨기면, 남은 관계가 하나도 없는 노드도 함께 숨긴다
    const nonTripIds = new Set();
    g.edges.forEach((e) => { if (!TRIP.has(e.label)) { nonTripIds.add(e.from); nonTripIds.add(e.to); } });
    const nodeView = new vis.DataView(nodes, {
      filter: (n) => groupOn[n.group] !== false && (!hideTrip.checked || nonTripIds.has(n.id)),
    });
    const edgeView = new vis.DataView(edges, { filter: (e) => !(hideTrip.checked && TRIP.has(e.rel)) });

    const filt = document.getElementById("groupfilters");
    Object.entries(GROUPS).forEach(([k, gdef]) => {
      const n = g.nodes.filter((x) => x.group === k).length;
      if (!n) return;
      const lab = document.createElement("label");
      lab.className = "check";
      lab.innerHTML = `<input type="checkbox" checked> <i class="dot" style="background:${gdef.color}"></i>${gdef.label} (${n})`;
      lab.querySelector("input").addEventListener("change", (ev) => { groupOn[k] = ev.target.checked; nodeView.refresh(); });
      filt.appendChild(lab);
    });


    const groups = {};
    Object.entries(GROUPS).forEach(([k, gdef]) => {
      groups[k] = { shape: gdef.shape, size: gdef.size, color: { background: gdef.color, border: gdef.color },
        font: { color: gdef.shape === "box" ? "#fff" : "#23201b", face: "Pretendard, Noto Sans KR, sans-serif" } };
    });

    const net = new vis.Network(document.getElementById("network"), { nodes: nodeView, edges: edgeView }, {
      groups,
      nodes: { font: { size: 13 } },
      edges: { font: { size: 11, align: "middle", strokeWidth: 3 }, smooth: { type: "continuous" }, arrows: { to: { scaleFactor: 0.5 } } },
      physics: { solver: "forceAtlas2Based", forceAtlas2Based: { gravitationalConstant: -60, springLength: 90 }, stabilization: { iterations: 300 } },
      interaction: { hover: true, tooltipDelay: 150 },
    });
    net.once("stabilizationIterationsDone", () => net.setOptions({ physics: { enabled: false } }));
    hideTrip.addEventListener("change", () => {
      edgeView.refresh(); nodeView.refresh();
      net.setOptions({ physics: { enabled: true } });
      net.stabilize(200);
      net.once("stabilized", () => { net.setOptions({ physics: { enabled: false } }); net.fit(); });
    });

    const info = document.getElementById("nodeinfo");
    net.on("click", (p) => {
      if (!p.nodes.length) return;
      const id = p.nodes[0];
      const n = nodes.get(id);
      const out = edges.get({ filter: (e) => e.from === id });
      const inc = edges.get({ filter: (e) => e.to === id });
      const line = (e, other) => `<li><b>${esc(e.rel)}</b> → ${esc(nodes.get(other)?.label)}${e.date ? ` <span class="muted">${esc(e.date)}</span>` : ""}${e.src ? ` <span class="tag">${esc(e.src)}</span>` : ""}</li>`;
      const lineIn = (e) => `<li>${esc(nodes.get(e.from)?.label)} <b>${esc(e.rel)}</b>${e.date ? ` <span class="muted">${esc(e.date)}</span>` : ""}${e.src ? ` <span class="tag">${esc(e.src)}</span>` : ""}</li>`;
      const raw = g.nodes.find((x) => x.id === id) || {};
      info.innerHTML = `<h3>${esc(n.label)} <span class="tag">${esc(GROUPS[n.group]?.label || n.group)}</span></h3>
        ${raw.existence ? `<div>현존 여부: ${esc(raw.existence)}</div>` : ""}
        ${out.length ? `<div class="muted">나가는 관계 ${out.length}</div><ul>${out.map((e) => line(e, e.to)).join("")}</ul>` : ""}
        ${inc.length ? `<div class="muted">들어오는 관계 ${inc.length}</div><ul>${inc.map(lineIn).join("")}</ul>` : ""}
        ${raw.lat != null ? `<button id="toMap">지도에서 보기</button>` : ""}`;
      const btn = document.getElementById("toMap");
      if (btn) btn.addEventListener("click", () => {
        showTab("map");
        const v = located.find((x) => x.place === raw.label);
        if (v) focusVisit(v);
      });
    });

    document.getElementById("search").addEventListener("change", (e) => {
      const q = e.target.value.trim();
      if (!q) return;
      const hit = nodes.get({ filter: (n) => n.label.includes(q) })[0];
      if (!hit) return;
      net.selectNodes([hit.id]);
      net.focus(hit.id, { scale: 1.4, animation: true });
      net.emit("click", { nodes: [hit.id] });
    });
  }

  const start = (location.hash || "").slice(1);
  if (["graph", "letters"].includes(start)) showTab(start);
})();
