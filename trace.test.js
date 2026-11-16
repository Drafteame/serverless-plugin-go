import { expect } from "chai";
import sinon from "sinon";

import { createTracer } from "./trace.js";

const tp = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

describe("Tracer", () => {
  let fetchStub;

  beforeEach(() => {
    fetchStub = sinon.stub(globalThis, "fetch").resolves({ ok: true });
  });

  afterEach(() => sinon.restore());

  const sent = () =>
    JSON.parse(fetchStub.firstCall.args[1].body).resourceSpans[0].scopeSpans[0]
      .spans;

  it("Is a no-op unless SP_GO_TRACE is set", async () => {
    const t = createTracer({ TRACEPARENT: tp });

    expect(await t.span("a", {}, async () => 42)).to.equal(42);
    await t.flush();

    expect(fetchStub).not.to.have.been.called;
  });

  it("Continues TRACEPARENT and nests spans, also under concurrency", async () => {
    const t = createTracer({
      SP_GO_TRACE: "1",
      TRACEPARENT: tp,
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318/",
      OTEL_EXPORTER_OTLP_HEADERS: "dd-api-key=abc, x=y=z",
    });

    await t.span("root", {}, () =>
      Promise.all([t.span("a", {}, async () => {}), t.span("b", {}, () => {})]),
    );
    await t.flush();

    const [url, opts] = fetchStub.firstCall.args;
    expect(url).to.equal("http://collector:4318/v1/traces");
    expect(opts.headers).to.include({ "dd-api-key": "abc", x: "y=z" });

    const spans = sent();
    const root = spans.find((s) => s.name === "root");
    expect(root.traceId).to.equal("0af7651916cd43dd8448eb211c80319c");
    expect(root.parentSpanId).to.equal("b7ad6b7169203331");
    for (const n of ["a", "b"]) {
      expect(spans.find((s) => s.name === n).parentSpanId).to.equal(
        root.spanId,
      );
    }
  });

  it("Starts a new trace on an invalid TRACEPARENT and records errors", async () => {
    const t = createTracer({ SP_GO_TRACE: "true", TRACEPARENT: "nope" });

    let err;
    try {
      await t.span("boom", { n: 1 }, async () => {
        throw new Error("bad");
      });
    } catch (e) {
      err = e;
    }
    await t.flush();

    expect(err.message).to.equal("bad");
    const [span] = sent();
    expect(span.parentSpanId).to.equal(undefined);
    expect(span.traceId).to.have.length(32);
    expect(span.status).to.deep.equal({ code: 2, message: "bad" });
  });

  it("Never throws when the export fails", async () => {
    fetchStub.rejects(new Error("down"));
    const t = createTracer({ SP_GO_TRACE: "1" });
    const onError = sinon.stub();

    t.span("a", {}, () => {});
    await t.flush(onError);

    expect(onError).to.have.been.calledOnceWith("trace export failed: down");
  });
});
