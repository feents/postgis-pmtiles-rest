# postgis-pmtiles-rest

English | [한국어](README.ko.md)

`postgis-pmtiles-rest` is a small REST service that exports a configured
PostGIS table to a PMTiles file.

It reads PostgreSQL connection settings, the source table, and the output path
from environment variables. When `POST /generate` is called, it streams
GeoJSON Features from PostGIS through `psql` into `tippecanoe`, then writes a
PMTiles file to the configured output directory.

## Features

- Simple REST API for PMTiles generation
- No npm runtime dependencies
- Streams data without writing an intermediate GeoJSON file
- Docker Compose support
- Configurable schema, table, geometry column, layer name, output path, and
  tippecanoe zoom options

## Requirements

For local execution:

- Node.js 20 or later
- `psql`
- `tippecanoe` 2.17 or later
- PostgreSQL with PostGIS enabled

For Docker Compose execution:

- Docker Compose
- Accessible PostgreSQL/PostGIS database

## Configuration

Create a local `.env` file:

```bash
cp .env.example .env
```

Edit `.env` for your database and output settings.

| Variable | Description |
| --- | --- |
| `HOST`, `PORT` | HTTP server bind address and port |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` | PostgreSQL connection settings |
| `POSTGIS_SCHEMA`, `POSTGIS_TABLE` | Source PostGIS schema and table |
| `GEOMETRY_COLUMN` | Geometry column to export |
| `OUTPUT_DIR`, `OUTPUT_FILENAME` | PMTiles output location |
| `LAYER_NAME` | Vector tile layer name |
| `TIPPECANOE_BIN`, `PSQL_BIN` | Executable names or paths |
| `TIPPECANOE_MIN_ZOOM`, `TIPPECANOE_MAX_ZOOM` | Optional zoom settings |
| `TIPPECANOE_EXTRA_ARGS` | Optional extra tippecanoe arguments |

## Run Locally

```bash
npm start
```

## Run with Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

Generated PMTiles files are written to the local `./output` directory by
default.

If the PostgreSQL server runs on the host machine, set `PGHOST` to
`host.docker.internal` when using Docker Desktop. If PostgreSQL runs as another
service in the same Compose network, set `PGHOST` to that service name.

## API

### `GET /health`

Returns service health.

```bash
curl http://localhost:3000/health
```

### `POST /generate`

Generates a PMTiles file from the configured PostGIS table.

```bash
curl -X POST http://localhost:3000/generate
```

You can override only the output filename in the request body:

```bash
curl -X POST http://localhost:3000/generate \
  -H 'content-type: application/json' \
  -d '{"outputFilename":"roads.pmtiles"}'
```

Example response:

```json
{
  "ok": true,
  "outputPath": "/app/output/roads.pmtiles",
  "table": "public.my_postgis_table",
  "layer": "postgis_layer"
}
```

## Notes

- `POST /generate` may overwrite an existing output file with the same name.
- The service does not expose arbitrary SQL. It only exports the table and
  geometry column configured in the environment.
- Geometry is excluded from feature properties. All other table columns are
  included as properties.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).

The Docker image includes third-party software such as tippecanoe and
PostgreSQL client tools. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Korean documentation is available in [README.ko.md](README.ko.md).
