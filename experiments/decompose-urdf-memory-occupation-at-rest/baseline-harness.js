'use strict';

const http = require('http');

const state = {
  jsonld: null,
  sparqljs: null,
  io: null,
  parser: null,
  urdf: null,
  store: null,
  processor: null,
};

function respond(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

/**
 * Triggers correspond to "baseline-heavy" lines in src/urdf-module.js of uRDF.js:
 *
 *  t1 -> const jsonld = require('jsonld');
 *  t2 -> const sparqljs = require('sparqljs');
 *  t3 -> const io = require('./io.js');              (here: require('urdf/src/io.js'))
 *  t4 -> const parser = new sparqljs.Parser();
 *  t5 -> const store = new urdf.Store();             (includes require('urdf') if not loaded)
 *
 * We keep references in `state` so allocations remain reachable and won't be GC'd immediately.
 */
function runTrigger(name) {
  switch (name) {
    case 't1': {
      if (!state.jsonld) state.jsonld = require('jsonld');
      // Mirror the module's `const processor = jsonld.promises;`
      state.processor = state.jsonld.promises;
      return { ok: true, did: "require('jsonld') + processor=jsonld.promises" };
    }
    case 't2': {
      if (!state.sparqljs) state.sparqljs = require('sparqljs');
      return { ok: true, did: "require('sparqljs')" };
    }
    case 't3': {
      if (!state.io) state.io = require('urdf/src/io.js');
      return { ok: true, did: "require('urdf/src/io.js')" };
    }
    case 't4': {
      if (!state.sparqljs) state.sparqljs = require('sparqljs');
      if (!state.parser) state.parser = new state.sparqljs.Parser();
      return { ok: true, did: "new sparqljs.Parser()" };
    }
    case 't5': {
      // Faithful to src/urdf-module.js:
      // const urdf = require('./urdf.js');
      // const store = new urdf.Store();

      if (!state.urdf) state.urdf = require('urdf/src/urdf.js');
      if (!state.store) state.store = new state.urdf.Store();

      return { ok: true, did: "require('urdf/src/urdf.js') + new urdf.Store()" };
    }
    default:
      return { ok: false, error: 'unknown trigger' };
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') return respond(res, 200, { ok: true });

  if (req.url.startsWith('/trigger')) {
    const url = new URL(req.url, 'http://localhost');
    const t = url.searchParams.get('t');
    try {
      const result = runTrigger(t);
      return respond(res, result.ok ? 200 : 400, result);
    } catch (e) {
      return respond(res, 500, { ok: false, error: String(e && e.stack ? e.stack : e) });
    }
  }

  return respond(res, 404, { ok: false, error: 'not found' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`baseline-harness listening on ${PORT}`));

