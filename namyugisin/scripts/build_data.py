#!/usr/bin/env python3
"""『남유기신』 입력 시트 → 뷰어용 JSON 변환 스크립트.

입력
  source/여정_시각화_데이터.csv   Visit 시트 (Drive '남유기신 여정 시각화 데이터 테이블')
  source/연재_목록.csv            연재 회차 시트 (Drive '남유기신 Sheet')
  source/relations.csv            관계 시트 (subject, predicate, object, ... ) — 없으면 건너뜀
  (.xlsx 도 받습니다: --visits 남유기신_입력용.xlsx --visits-sheet Visit)

출력
  viewer/data/visits.json, letters.json, graph.json
  viewer/data/data.js   (위 세 JSON을 한 파일로 묶은 것. file:// 로 열어도 동작하게 하려고 둠)

사용
  python3 scripts/build_data.py
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATE_RE = re.compile(r"(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일")


def read_table(path: Path, sheet: str | None = None) -> list[dict]:
    if path.suffix.lower() in (".xlsx", ".xlsm"):
        import openpyxl  # 필요할 때만

        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        ws = wb[sheet] if sheet else wb.worksheets[0]
        rows = list(ws.iter_rows(values_only=True))
        header = [str(h).strip() if h is not None else "" for h in rows[0]]
        return [
            {header[i]: ("" if v is None else str(v)).strip() for i, v in enumerate(r) if i < len(header)}
            for r in rows[1:]
        ]
    with path.open(encoding="utf-8-sig", newline="") as f:
        return [{(k or "").strip(): (v or "").strip() for k, v in row.items()} for row in csv.DictReader(f)]


def iso_date(s: str) -> str | None:
    m = DATE_RE.search(s)
    if not m:
        return None
    y, mo, d = map(int, m.groups())
    return f"{y:04d}-{mo:02d}-{d:02d}"


def to_float(s: str) -> float | None:
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def to_int(s: str) -> int | None:
    try:
        return int(s)
    except (TypeError, ValueError):
        return None


def build_visits(rows: list[dict]) -> list[dict]:
    visits = []
    known_coords: dict[str, tuple[float, float, str]] = {}
    for idx, r in enumerate(rows, start=1):
        name = r.get("경유지", "")
        if not name:
            continue
        lat, lng = to_float(r.get("위도")), to_float(r.get("경도"))
        addr = r.get("현대주소", "")
        coord_source = "sheet"
        if lat is not None and lng is not None:
            known_coords[name] = (lat, lng, addr)
        elif name in known_coords:
            # 같은 장소에 연박한 행은 좌표를 비워 두는 경우가 많아 앞 행 좌표를 이어받는다
            lat, lng, prev_addr = known_coords[name]
            addr = addr or prev_addr
            coord_source = "inherited"
        else:
            coord_source = "missing"
        stay = r.get("유숙여부", "")
        visits.append(
            {
                "id": f"V{idx:03d}",
                "row": idx,
                "date": iso_date(r.get("방문일", "")),
                "dateLabel": r.get("방문일", ""),
                "place": name,
                "order": to_int(r.get("방문순서")),
                "orderLabel": r.get("방문순서", ""),
                "stay": stay.startswith("유숙"),
                "stayLabel": stay,
                "lat": lat,
                "lng": lng,
                "coordSource": coord_source,
                "modernAddress": addr,
                "certainty": r.get("certainty", ""),
                "category": r.get("분류", ""),
                "type": r.get("구분", ""),
                "existence": r.get("현존/현전/부존", ""),
                "evidence": r.get("비정근거", ""),
                "note": r.get("비고", ""),
            }
        )
    return visits


def build_letters(rows: list[dict]) -> list[dict]:
    return [
        {
            "id": f"L{i:02d}",
            "published": r.get("date", ""),
            "no": r.get("no.", ""),
            "subhead": r.get("subhead", ""),
            "note": r.get("note", ""),
        }
        for i, r in enumerate(rows, start=1)
        if r.get("date")
    ]


def build_graph(visits: list[dict], relations: list[dict]) -> dict:
    nodes: dict[str, dict] = {}

    def add(nid: str, label: str, group: str, **extra):
        if nid not in nodes:
            nodes[nid] = {"id": nid, "label": label, "group": group, **extra}

    edges = []
    add("P:정인보", "정인보", "person")
    add("W:남유기신", "남유기신", "work")
    edges.append({"from": "P:정인보", "to": "W:남유기신", "label": "저술", "source": "기본"})

    # 여정 데이터에서 '정인보 —방문/유숙→ 장소' 를 자동 생성
    seen = set()
    for v in visits:
        pid = f"L:{v['place']}"
        add(pid, v["place"], "place", existence=v["existence"], lat=v["lat"], lng=v["lng"])
        rel = "유숙" if v["stay"] else "방문"
        key = (pid, rel)
        if key in seen:
            continue
        seen.add(key)
        edges.append({"from": "P:정인보", "to": pid, "label": rel, "date": v["date"], "source": "여정 시트"})

    # 관계 시트(있으면): subject, subject_type, predicate, object, object_type, source
    prefix = {"person": "P", "place": "L", "work": "W", "org": "O"}
    for r in relations:
        s, o, p = r.get("subject"), r.get("object"), r.get("predicate")
        if not (s and o and p):
            continue
        st, ot = r.get("subject_type") or "person", r.get("object_type") or "place"
        sid, oid = f"{prefix.get(st, 'X')}:{s}", f"{prefix.get(ot, 'X')}:{o}"
        add(sid, s, st)
        add(oid, o, ot)
        edges.append({"from": sid, "to": oid, "label": p, "source": r.get("source", ""), "note": r.get("note", "")})

    return {"nodes": list(nodes.values()), "edges": edges}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--visits", type=Path, default=ROOT / "source" / "여정_시각화_데이터.csv")
    ap.add_argument("--visits-sheet")
    ap.add_argument("--letters", type=Path, default=ROOT / "source" / "연재_목록.csv")
    ap.add_argument("--relations", type=Path, default=ROOT / "source" / "relations.csv")
    ap.add_argument("--out", type=Path, default=ROOT / "viewer" / "data")
    a = ap.parse_args()

    visits = build_visits(read_table(a.visits, a.visits_sheet))
    letters = build_letters(read_table(a.letters)) if a.letters.exists() else []
    relations = read_table(a.relations) if a.relations.exists() else []
    graph = build_graph(visits, relations)

    a.out.mkdir(parents=True, exist_ok=True)
    bundle = {"visits": visits, "letters": letters, "graph": graph}
    for k, v in bundle.items():
        (a.out / f"{k}.json").write_text(json.dumps(v, ensure_ascii=False, indent=1), encoding="utf-8")
    (a.out / "data.js").write_text(
        "// build_data.py 가 생성한 파일입니다. 직접 고치지 마세요.\nwindow.NAMYU_DATA = "
        + json.dumps(bundle, ensure_ascii=False)
        + ";\n",
        encoding="utf-8",
    )
    located = sum(1 for v in visits if v["lat"] is not None)
    print(f"visits {len(visits)} (좌표 {located}), letters {len(letters)}, "
          f"graph nodes {len(graph['nodes'])} edges {len(graph['edges'])} → {a.out}")


if __name__ == "__main__":
    main()
