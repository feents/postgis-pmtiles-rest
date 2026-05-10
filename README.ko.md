# postgis-pmtiles-rest

[English](README.md) | 한국어

`postgis-pmtiles-rest`는 설정된 PostGIS 테이블을 PMTiles 파일로 내보내는 작은 REST 서비스입니다.

PostgreSQL 접속 정보, 원본 테이블, 출력 경로를 환경변수에서 읽습니다.
`POST /generate` 요청을 받으면 PostGIS 데이터를 `psql`로 GeoJSON Feature 스트림으로 내보내고,
그 스트림을 `tippecanoe`에 전달해 PMTiles 파일을 생성합니다.

## 기능

- PMTiles 생성을 위한 단순 REST API
- npm 런타임 의존성 없음
- 중간 GeoJSON 파일을 만들지 않는 스트리밍 처리
- Docker Compose 실행 지원
- schema, table, geometry column, layer name, output path, tippecanoe zoom 옵션 설정 가능

## 요구사항

로컬 실행:

- Node.js 20 이상
- `psql`
- `tippecanoe` 2.17 이상
- PostGIS가 활성화된 PostgreSQL

Docker Compose 실행:

- Docker Compose
- 접근 가능한 PostgreSQL/PostGIS 데이터베이스

## 설정

로컬 `.env` 파일을 만듭니다.

```bash
cp .env.example .env
```

`.env`에서 DB와 출력 설정을 수정합니다.

| 변수 | 설명 |
| --- | --- |
| `HOST`, `PORT` | HTTP 서버 바인드 주소와 포트 |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` | PostgreSQL 접속 정보 |
| `POSTGIS_SCHEMA`, `POSTGIS_TABLE` | 원본 PostGIS schema와 table |
| `GEOMETRY_COLUMN` | 내보낼 geometry 컬럼 |
| `OUTPUT_DIR`, `OUTPUT_FILENAME` | PMTiles 출력 위치 |
| `LAYER_NAME` | 벡터 타일 레이어명 |
| `TIPPECANOE_BIN`, `PSQL_BIN` | 실행 파일명 또는 경로 |
| `TIPPECANOE_MIN_ZOOM`, `TIPPECANOE_MAX_ZOOM` | 선택 줌 설정 |
| `TIPPECANOE_EXTRA_ARGS` | 선택 tippecanoe 추가 옵션 |

## 로컬 실행

```bash
npm start
```

## Docker Compose 실행

```bash
cp .env.example .env
docker compose up --build
```

생성된 PMTiles 파일은 기본적으로 로컬 `./output` 디렉터리에 저장됩니다.

Docker Desktop에서 컨테이너가 호스트 머신의 PostgreSQL에 접속해야 한다면
`PGHOST`를 `host.docker.internal`로 설정합니다. PostgreSQL이 같은 Compose 네트워크의
다른 서비스라면 해당 서비스명을 `PGHOST`에 넣습니다.

## API

### `GET /health`

서비스 상태를 반환합니다.

```bash
curl http://localhost:3000/health
```

### `POST /generate`

설정된 PostGIS 테이블에서 PMTiles 파일을 생성합니다.

```bash
curl -X POST http://localhost:3000/generate
```

요청 본문으로 출력 파일명만 덮어쓸 수 있습니다.

```bash
curl -X POST http://localhost:3000/generate \
  -H 'content-type: application/json' \
  -d '{"outputFilename":"roads.pmtiles"}'
```

성공 응답 예시:

```json
{
  "ok": true,
  "outputPath": "/app/output/roads.pmtiles",
  "table": "public.my_postgis_table",
  "layer": "postgis_layer"
}
```

## 참고

- `POST /generate`는 같은 이름의 출력 파일을 덮어쓸 수 있습니다.
- 이 서비스는 임의 SQL을 노출하지 않고 환경변수로 설정된 table과 geometry column만 내보냅니다.
- geometry 컬럼은 feature properties에서 제외되며, 나머지 컬럼은 properties에 포함됩니다.

## 라이선스

이 프로젝트는 MIT License로 배포됩니다. [LICENSE](LICENSE)를 확인하세요.

Docker 이미지에는 tippecanoe, PostgreSQL client 같은 제3자 소프트웨어가 포함됩니다.
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 함께 확인하세요.

영문 문서는 [README.md](README.md)에 있습니다.
