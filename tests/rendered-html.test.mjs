import assert from "node:assert/strict";
import test from "node:test";

async function createWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

function fetchFrom(worker, path, init) {
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the Dutch Youtarr subscription shell", async () => {
  const worker = await createWorker();
  const response = await fetchFrom(worker, "/");

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="nl"/i);
  assert.match(html, /<title>Youtarr Feed<\/title>/i);
  assert.match(html, /Je abonnementen/);
  assert.match(html, /Kanalen/);
  assert.match(html, /Nog ophalen/);
});

test("serves the demo feed before Youtarr is configured", async () => {
  const worker = await createWorker();
  const [statusResponse, feedResponse] = await Promise.all([
    fetchFrom(worker, "/api/status"),
    fetchFrom(worker, "/api/feed"),
  ]);

  assert.equal(statusResponse.status, 200);
  assert.equal(feedResponse.status, 200);

  const status = await statusResponse.json();
  const feed = await feedResponse.json();
  assert.equal(status.mode, "demo");
  assert.equal(status.connected, false);
  assert.equal(status.plexConfigured, false);
  assert.equal(feed.mode, "demo");
  assert.ok(feed.channels.length >= 4);
  assert.ok(feed.videos.some((video) => video.downloaded === false));
});

test("skips a Plex refresh when the optional integration is empty", async () => {
  const worker = await createWorker();
  const response = await fetchFrom(worker, "/api/plex/refresh", {
    method: "POST",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    skipped: true,
    configured: false,
  });
});

test("validates downloads and simulates them in demo mode", async () => {
  const worker = await createWorker();
  const invalid = await fetchFrom(worker, "/api/download", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "te-kort" }),
  });
  assert.equal(invalid.status, 400);

  const valid = await fetchFrom(worker, "/api/download", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "dmo00000001" }),
  });
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), {
    success: true,
    demo: true,
    message: "Voorbeelddownload gestart",
  });
});
