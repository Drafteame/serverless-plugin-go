import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

// Opt-in tracing: SP_GO_TRACE=1 turns it on, otherwise every call is a no-op.
// Spans continue the W3C `traceparent` found in TRACEPARENT (if any) and are
// exported as OTLP/HTTP JSON using the standard OTEL_EXPORTER_OTLP_* env vars.
// ponytail: no SDK, no batching, one POST at the end of the run; tracing must
// never break a build, so every export error is swallowed.

const traceparentRe = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const hex = (bytes) => randomBytes(bytes).toString("hex");
const nowNano = () =>
  String(
    BigInt(Math.round((performance.timeOrigin + performance.now()) * 1e6)),
  );

// Allowlist only: never dump process.env into a public trace.
const ciEnvAttrs = {
  GITHUB_REPOSITORY: "git.repository",
  GITHUB_SHA: "git.commit.sha",
  GITHUB_REF_NAME: "git.branch",
  GITHUB_RUN_ID: "ci.pipeline.id",
  GITHUB_RUN_ATTEMPT: "ci.pipeline.run_attempt",
  GITHUB_JOB: "ci.job.name",
};

function toValue(v) {
  if (typeof v === "boolean") return { boolValue: v };
  if (Number.isInteger(v)) return { intValue: String(v) };
  if (typeof v === "number") return { doubleValue: v };
  return { stringValue: String(v) };
}

function toAttrs(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([key, v]) => ({ key, value: toValue(v) }));
}

function parseHeaders(raw = "") {
  return Object.fromEntries(
    raw
      .split(",")
      .map((p) => p.split(/=(.*)/s))
      .filter(([k]) => k && k.trim())
      .map(([k, v]) => [k.trim(), (v || "").trim()]),
  );
}

const noopSpan = { enabled: false, set() {} };

export function createTracer(env = process.env, resource = {}) {
  if (!/^(1|true)$/i.test(env.SP_GO_TRACE || "")) {
    return {
      enabled: false,
      span: (name, attrs, fn) => fn(noopSpan),
      flush: async () => {},
    };
  }

  const als = new AsyncLocalStorage();
  const spans = [];
  const m = traceparentRe.exec((env.TRACEPARENT || "").trim());
  const traceId = m ? m[1] : hex(16);
  const flags = m ? m[3] : "01";
  const remoteParent = m ? m[2] : undefined;

  const ciAttrs = Object.fromEntries(
    Object.entries(ciEnvAttrs)
      .filter(([k]) => env[k])
      .map(([k, attr]) => [attr, env[k]]),
  );

  function span(name, attrs, fn) {
    const parentId = als.getStore() || remoteParent;
    const rec = {
      traceId,
      spanId: hex(8),
      parentSpanId: parentId,
      name,
      kind: 1,
      startTimeUnixNano: nowNano(),
      attributes: { ...attrs },
      status: { code: 1 },
    };
    const handle = {
      enabled: true,
      set: (k, v) => {
        rec.attributes[k] = v;
      },
    };
    const finish = (err) => {
      rec.endTimeUnixNano = nowNano();
      if (err) rec.status = { code: 2, message: String(err.message || err) };
      spans.push({ ...rec, attributes: toAttrs(rec.attributes) });
    };

    let result;
    try {
      result = als.run(rec.spanId, () => fn(handle));
    } catch (e) {
      finish(e);
      throw e;
    }
    if (result && typeof result.then === "function") {
      return result.then(
        (v) => {
          finish();
          return v;
        },
        (e) => {
          finish(e);
          throw e;
        },
      );
    }
    finish();
    return result;
  }

  // Sends the finished spans; reports failures through onError and never throws.
  async function flush(onError = () => {}) {
    if (!spans.length) return;
    const body = {
      resourceSpans: [
        {
          resource: {
            attributes: toAttrs({
              "service.name": env.OTEL_SERVICE_NAME || "serverless-go-plugin",
              ...ciAttrs,
              ...resource,
            }),
          },
          scopeSpans: [
            {
              scope: { name: "serverless-go-plugin" },
              spans: spans
                .splice(0)
                .map((s) => ({ ...s, flags: parseInt(flags, 16) })),
            },
          ],
        },
      ],
    };
    const base = (
      env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318"
    ).replace(/\/$/, "");
    const url = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || `${base}/v1/traces`;
    try {
      const res = await globalThis.fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) onError(`trace export failed: HTTP ${res.status}`);
    } catch (e) {
      onError(`trace export failed: ${e.message}`);
    }
  }

  return { enabled: true, span, flush };
}
