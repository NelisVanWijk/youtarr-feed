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
  assert.match(html, /Losse video/);
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

test("reports idle activity before Youtarr is configured", async () => {
  const worker = await createWorker();
  const response = await fetchFrom(worker, "/api/activity");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    state: "idle",
    label: "Geen actieve download",
    percent: 0,
  });
});

test("simulates deleting a download in demo mode", async () => {
  const worker = await createWorker();
  const response = await fetchFrom(worker, "/api/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "dmo00000002" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    demo: true,
  });
});

test("requires a live Youtarr connection before adding channels", async () => {
  const worker = await createWorker();
  const response = await fetchFrom(worker, "/api/channels/add", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://www.youtube.com/@openai" }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Youtarr gekoppeld/);
});

test("stores single YouTube videos server-side", async () => {
  const worker = await createWorker();
  const invalid = await fetchFrom(worker, "/api/single-videos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/watch?v=not-youtube" }),
  });
  assert.equal(invalid.status, 400);

  const videoId = "dQw4w9WgXcQ";
  const added = await fetchFrom(worker, "/api/single-videos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: `https://youtu.be/${videoId}` }),
  });
  assert.equal(added.status, 200);
  assert.equal((await added.json()).video.id, videoId);

  const loaded = await fetchFrom(worker, "/api/single-videos");
  assert.equal(loaded.status, 200);
  assert.ok((await loaded.json()).videos.some((video) => video.id === videoId));

  const removed = await fetchFrom(worker, "/api/single-videos", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: videoId }),
  });
  assert.equal(removed.status, 200);
  assert.equal(
    (await removed.json()).videos.some((video) => video.id === videoId),
    false,
  );
});

test("stores watch progress server-side", async () => {
  const worker = await createWorker();
  const videoId = "dmo00000003";

  const saved = await fetchFrom(worker, "/api/watch-progress", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ videoId, currentTime: 42, duration: 600 }),
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).progress[videoId].currentTime, 42);

  const loaded = await fetchFrom(worker, "/api/watch-progress");
  assert.equal(loaded.status, 200);
  assert.equal((await loaded.json()).progress[videoId].duration, 600);

  const cleared = await fetchFrom(worker, "/api/watch-progress", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ videoId }),
  });
  assert.equal(cleared.status, 200);
  assert.equal((await cleared.json()).progress[videoId], undefined);
});
