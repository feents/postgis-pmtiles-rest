'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Transform } = require('node:stream');

const ROOT_DIR = path.resolve(__dirname, '..');
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
let requestSequence = 0;

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

function env(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function requireEnv(name) {
  const value = env(name);
  if (!value) {
    throw httpError(500, `Missing required environment variable: ${name}`);
  }
  return value;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertIdentifier(name, value, required = true) {
  if (!value && !required) {
    return '';
  }
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw httpError(400, `${name} must be a PostgreSQL identifier.`);
  }
  return value;
}

function quoteIdentifier(value) {
  assertIdentifier('identifier', value);
  return `"${value}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function parseExtraArgs(value) {
  if (!value) {
    return [];
  }
  return value.match(/"[^"]*"|'[^']*'|\S+/g)?.map((part) => {
    if (
      (part.startsWith('"') && part.endsWith('"')) ||
      (part.startsWith("'") && part.endsWith("'"))
    ) {
      return part.slice(1, -1);
    }
    return part;
  }) ?? [];
}

function getConfig() {
  const schema = assertIdentifier('POSTGIS_SCHEMA', env('POSTGIS_SCHEMA', 'public'));
  const table = assertIdentifier('POSTGIS_TABLE', requireEnv('POSTGIS_TABLE'));
  const geometryColumn = assertIdentifier('GEOMETRY_COLUMN', env('GEOMETRY_COLUMN', 'geom'));
  const outputDir = path.resolve(ROOT_DIR, env('OUTPUT_DIR', './output'));
  const layerName = assertIdentifier('LAYER_NAME', env('LAYER_NAME', table));

  return {
    host: env('HOST', '0.0.0.0'),
    port: Number.parseInt(env('PORT', '3000'), 10),
    pgHost: requireEnv('PGHOST'),
    pgPort: env('PGPORT', '5432'),
    pgDatabase: requireEnv('PGDATABASE'),
    pgUser: requireEnv('PGUSER'),
    pgPassword: env('PGPASSWORD'),
    schema,
    table,
    geometryColumn,
    outputDir,
    outputFilename: env('OUTPUT_FILENAME', `${table}.pmtiles`),
    layerName,
    tippecanoeBin: env('TIPPECANOE_BIN', 'tippecanoe'),
    psqlBin: env('PSQL_BIN', 'psql'),
    minZoom: env('TIPPECANOE_MIN_ZOOM'),
    maxZoom: env('TIPPECANOE_MAX_ZOOM'),
    extraTippecanoeArgs: parseExtraArgs(env('TIPPECANOE_EXTRA_ARGS')),
  };
}

function buildCopySql(config) {
  const tableRef = `${quoteIdentifier(config.schema)}.${quoteIdentifier(config.table)}`;
  const geometryRef = `t.${quoteIdentifier(config.geometryColumn)}`;
  const propertiesExpression = `to_jsonb(t) - ${quoteLiteral(config.geometryColumn)}`;

  return `
COPY (
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'type', 'Feature',
    'geometry', ST_AsGeoJSON(${geometryRef})::jsonb,
    'properties', ${propertiesExpression}
  ))::text
  FROM ${tableRef} AS t
  WHERE ${geometryRef} IS NOT NULL
) TO STDOUT;
`;
}

function safeOutputPath(config, requestedFilename) {
  const filename = requestedFilename || config.outputFilename;
  if (!/^[A-Za-z0-9._-]+\.pmtiles$/.test(filename)) {
    throw httpError(400, 'outputFilename must end with .pmtiles and contain only letters, numbers, dots, underscores, or hyphens.');
  }

  const outputPath = path.resolve(config.outputDir, filename);
  if (!outputPath.startsWith(config.outputDir + path.sep)) {
    throw httpError(400, 'outputFilename resolves outside OUTPUT_DIR.');
  }
  return outputPath;
}

function buildTippecanoeArgs(config, outputPath) {
  const args = ['-o', outputPath, '-l', config.layerName, '--force'];
  if (config.minZoom) {
    args.push('-Z', config.minZoom);
  }
  if (config.maxZoom) {
    args.push('-z', config.maxZoom);
  } else {
    args.push('-zg');
  }
  args.push(...config.extraTippecanoeArgs);
  return args;
}

function now() {
  return new Date().toISOString();
}

function logInfo(message, context = {}) {
  console.log(formatLog('info', message, context));
}

function logError(message, context = {}) {
  console.error(formatLog('error', message, context));
}

function formatLog(level, message, context) {
  const fields = Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ');
  return `[${now()}] ${level.toUpperCase()} ${message}${fields ? ` ${fields}` : ''}`;
}

function createProgressCounter(context) {
  let featureCount = 0;
  let byteCount = 0;
  let pending = '';
  let lastLoggedAt = Date.now();
  let nextFeatureLog = 10000;

  return new Transform({
    transform(chunk, encoding, callback) {
      const text = chunk.toString();
      byteCount += Buffer.byteLength(chunk);
      pending += text;

      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      featureCount += lines.filter(Boolean).length;

      const shouldLog =
        featureCount > 0 &&
        (featureCount >= nextFeatureLog || Date.now() - lastLoggedAt >= 5000);
      if (shouldLog) {
        lastLoggedAt = Date.now();
        nextFeatureLog = featureCount + 10000;
        logInfo('export progress', {
          ...context,
          features: featureCount,
          bytes: byteCount,
        });
      }

      callback(null, chunk);
    },
    flush(callback) {
      if (pending.trim()) {
        featureCount += 1;
      }
      logInfo('export stream complete', {
        ...context,
        features: featureCount,
        bytes: byteCount,
      });
      callback();
    },
  });
}

function collectProcessError(processName, child, context = {}) {
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) {
        logInfo(`${processName} output`, { ...context, message: line.trim() });
      }
    }
  });
  return () => `${processName} failed: ${stderr.trim() || 'no stderr output'}`;
}

function generatePmtiles(config, outputPath, context) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const psqlArgs = [
      '-h',
      config.pgHost,
      '-p',
      config.pgPort,
      '-U',
      config.pgUser,
      '-d',
      config.pgDatabase,
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-A',
      '-t',
      '-c',
      buildCopySql(config),
    ];
    const tippecanoeArgs = buildTippecanoeArgs(config, outputPath);
    const childEnv = { ...process.env, PGPASSWORD: config.pgPassword };

    logInfo('generation started', {
      ...context,
      table: `${config.schema}.${config.table}`,
      layer: config.layerName,
      outputPath,
    });
    logInfo('starting psql export', context);
    const psql = spawn(config.psqlBin, psqlArgs, { env: childEnv });
    logInfo('starting tippecanoe conversion', {
      ...context,
      minZoom: config.minZoom,
      maxZoom: config.maxZoom || 'auto',
    });
    const tippecanoe = spawn(config.tippecanoeBin, tippecanoeArgs);
    const progressCounter = createProgressCounter(context);

    const psqlErrorMessage = collectProcessError('psql', psql, context);
    const tippecanoeErrorMessage = collectProcessError('tippecanoe', tippecanoe, context);
    let psqlExitCode = null;
    let tippecanoeExitCode = null;
    let settled = false;
    const startedAt = Date.now();

    function fail(error) {
      if (!settled) {
        settled = true;
        logError('generation failed', {
          ...context,
          error: error.message,
          durationMs: Date.now() - startedAt,
        });
        reject(error);
      }
    }

    function maybeResolve() {
      if (settled || psqlExitCode === null || tippecanoeExitCode === null) {
        return;
      }
      if (psqlExitCode !== 0) {
        fail(new Error(psqlErrorMessage()));
        return;
      }
      if (tippecanoeExitCode !== 0) {
        fail(new Error(tippecanoeErrorMessage()));
        return;
      }
      settled = true;
      logInfo('generation completed', {
        ...context,
        outputPath,
        durationMs: Date.now() - startedAt,
      });
      resolve();
    }

    psql.on('error', fail);
    tippecanoe.on('error', fail);
    psql.stdout.on('error', fail);
    progressCounter.on('error', fail);
    tippecanoe.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') {
        fail(error);
      }
    });

    psql.stdout.pipe(progressCounter).pipe(tippecanoe.stdin);
    psql.on('close', (code) => {
      psqlExitCode = code;
      logInfo('psql export finished', { ...context, exitCode: code });
      maybeResolve();
    });
    tippecanoe.on('close', (code) => {
      tippecanoeExitCode = code;
      logInfo('tippecanoe conversion finished', { ...context, exitCode: code });
      maybeResolve();
    });
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload, null, 2));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 1024 * 1024) {
        reject(httpError(413, 'Request body is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(httpError(400, 'Request body must be valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestId = `req-${++requestSequence}`;
  const startedAt = Date.now();
  request.requestId = requestId;
  const config = getConfig();

  logInfo('request received', {
    requestId,
    method: request.method,
    path: url.pathname,
  });

  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { ok: true });
    logInfo('request completed', {
      requestId,
      statusCode: 200,
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/generate') {
    const body = await readJsonBody(request);
    const outputPath = safeOutputPath(config, body.outputFilename);

    await generatePmtiles(config, outputPath, { requestId });

    sendJson(response, 200, {
      ok: true,
      outputPath,
      table: `${config.schema}.${config.table}`,
      layer: config.layerName,
    });
    logInfo('request completed', {
      requestId,
      statusCode: 200,
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  sendJson(response, 404, { ok: false, error: 'Not found' });
  logInfo('request completed', {
    requestId,
    statusCode: 404,
    durationMs: Date.now() - startedAt,
  });
}

function start() {
  loadEnv(path.join(ROOT_DIR, '.env'));

  const config = getConfig();
  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      const statusCode = error.statusCode || 500;
      logError('request failed', {
        requestId: request.requestId,
        method: request.method,
        url: request.url,
        statusCode,
        error: error.message,
      });
      sendJson(response, statusCode, {
        ok: false,
        error: error.message,
      });
    });
  });

  server.listen(config.port, config.host, () => {
    console.log(`postgis-pmtiles-rest listening on http://${config.host}:${config.port}`);
  });
  server.on('error', (error) => {
    console.error(`failed to start server: ${error.message}`);
    process.exitCode = 1;
  });
}

start();
