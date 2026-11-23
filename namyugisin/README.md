# 남유기신 지식그래프

정인보(鄭寅普)가 1934년 『동아일보』에 연재한 호남 유람기 『남유기신(南遊寄信)』을 대상으로 한 시맨틱 데이터와 웹 뷰어입니다.

```
namyugisin/
├── source/                  입력 시트에서 내보낸 원본 (CSV)
│   ├── 여정_시각화_데이터.csv   Drive '남유기신 여정 시각화 데이터 테이블' (Visit)
│   ├── 연재_목록.csv           Drive '남유기신 Sheet' (연재 회차)
│   └── relations.csv          인물·장소·문헌 관계 (지금은 샘플)
├── scripts/build_data.py    source → viewer/data/*.json, data.js 변환
└── viewer/                  빌드 없이 동작하는 정적 웹 뷰어
    ├── index.html, app.js, style.css
    ├── data/                visits.json, letters.json, graph.json, data.js (생성물)
    └── lib/                 Leaflet 1.9.4, vis-network 9.1.9 (오프라인 발표용으로 저장소에 포함)
```

## 뷰어 열기

`viewer/index.html` 을 브라우저에서 바로 열면 됩니다(데이터를 `data/data.js` 로 읽어서 `file://` 에서도 동작).
배경 지도 타일(CARTO/OSM)만 인터넷이 필요하고, 경로·마커·그래프는 오프라인에서도 그려집니다.

로컬 서버로 열고 싶다면:

```bash
cd namyugisin/viewer && python3 -m http.server 8000   # http://localhost:8000
```

### 화면

- **여정 지도**: 시트 행 순서대로 이은 경로, 경유지(흰 원)·유숙지(붉은 원). 오른쪽 타임라인에서 날짜·지점을 누르면 이동합니다.
  슬라이더/▶재생/←→ 키로 하루씩 넘기면 그날 구간이 붉게 강조됩니다. `Esc` 는 전체 보기.
- **관계 네트워크**: 정인보 ―방문/유숙→ 장소(여정 시트에서 자동 생성) + `relations.csv` 의 관계.
  '여정 관계 숨기기' 를 켜면 인물·문헌 관계만 남습니다. 노드를 누르면 관계 목록과 '지도에서 보기'.
- **연재 목록**: 회차별 게재일과 부제.

## 데이터 갱신

1. Google 시트에서 CSV로 내려받아 `source/` 의 같은 이름 파일을 덮어씁니다.
   (xlsx 를 그대로 쓰려면 `--visits 남유기신_입력용.xlsx --visits-sheet Visit`)
2. `python3 scripts/build_data.py` 실행 → `viewer/data/` 가 새로 만들어집니다.

변환 규칙
- `방문일` "1934년 7월 14일" → `1934-07-14`. `방문순서`가 숫자가 아니면(`불명`, 빈칸) `order: null`, 원문은 `orderLabel`.
- 좌표가 빈 행은 **앞서 나온 같은 이름 장소의 좌표를 이어받습니다**(`coordSource: "inherited"`, 연박한 날 등). 그래도 없으면 `missing` 이고 지도에는 찍지 않고 타임라인에만 회색으로 보입니다.
- `유숙여부`가 '유숙'으로 시작하면 `stay: true` ('유숙(아마도?)' 포함, 원문은 `stayLabel`).

### relations.csv 형식

| subject | subject_type | predicate | object | object_type | source | note |
|---|---|---|---|---|---|---|

`*_type` 은 `person` / `place` / `work` / `org`. 장소 이름을 여정 시트의 `경유지`와 똑같이 쓰면 같은 노드로 합쳐집니다.
현재 행들은 여정 시트 비고·비정근거와 연재 부제에서 뽑은 **샘플**이며, `동행(확인 필요)` 는 원문 확인 전이라 점선으로 그립니다.
