import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../webos/launcher.js', import.meta.url), 'utf8');

function launcher(saved, storageFails = false) {
  const elements = Object.fromEntries(['server', 'setup', 'open', 'exit', 'error', 'automatic', 'change'].map(id => [id, { value: '', textContent: '', focus() { document.activeElement = this; } }]));
  const document = { activeElement: null, getElementById: id => elements[id], addEventListener() {} };
  const window = { location: { href: '' }, close() {} };
  const storage = new Map(saved ? [['mytube-server', saved]] : []);
  const localStorage = {
    getItem: key => { if (storageFails) throw new Error('Disabled'); return storage.get(key); },
    setItem: (key, value) => { if (storageFails) throw new Error('Disabled'); storage.set(key, value); },
  };
  let automatic;
  vm.runInNewContext(source, { document, window, localStorage, URL, setTimeout(callback) { automatic = callback; return 1; }, clearTimeout() { automatic = null; } });
  return { elements, window, storage, runAutomatic() { automatic?.(); }, submit(address) { elements.server.value = address; elements.setup.onsubmit({ preventDefault() {} }); } };
}

test('webOS launcher opens and remembers a changed server, retaining its port', () => {
  const app = launcher('http://old-server:3090');
  assert.equal(app.elements.server.value, 'http://old-server:3090');
  app.submit('https://mytube.example:8443/tv/index.html');
  assert.equal(app.window.location.href, 'https://mytube.example:8443/tv/index.html');
  assert.equal(app.storage.get('mytube-server'), 'https://mytube.example:8443');
  assert.equal(launcher(app.storage.get('mytube-server')).elements.server.value, 'https://mytube.example:8443');
});

test('webOS launcher rejects unsupported addresses without overwriting the saved server', () => {
  for (const address of ['javascript:alert(1)', 'file:///tmp/index.html', 'http://user:password@example.com', 'http://example.com/other-app', 'not a URL']) {
    const app = launcher('http://old-server:3090');
    app.submit(address);
    assert.equal(app.window.location.href, '');
    assert.equal(app.storage.get('mytube-server'), 'http://old-server:3090');
    assert.ok(app.elements.error.textContent);
  }
});

test('webOS launcher can connect when persistent storage is unavailable', () => {
  const app = launcher(null, true);
  app.submit('http://192.168.1.20:3090/tv');
  assert.equal(app.window.location.href, 'http://192.168.1.20:3090/tv/index.html');
});

test('saved servers open automatically, but editing cancels automatic navigation', () => {
  const app = launcher('http://my-server:3090');
  app.runAutomatic();
  assert.equal(app.window.location.href, 'http://my-server:3090/tv/index.html');
  const editing = launcher('http://my-server:3090');
  editing.elements.change.onclick(); editing.runAutomatic();
  assert.equal(editing.window.location.href, '');
  const firstLaunch = launcher(); firstLaunch.runAutomatic();
  assert.equal(firstLaunch.window.location.href, '');
});
