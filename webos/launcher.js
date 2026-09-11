(function () {
  'use strict';
  var input = document.getElementById('server');
  input.value = 'http://192.168.100.43:3090';
  try { input.value = localStorage.getItem('mytube-server') || input.value; } catch { /* Storage may be disabled. */ }
  document.getElementById('setup').onsubmit = function (event) {
    event.preventDefault();
    try {
      var url = new URL(input.value.trim());
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error('Enter an HTTP or HTTPS address without a username or password.');
      if (url.pathname !== '/' && url.pathname !== '/tv' && url.pathname !== '/tv/' && url.pathname !== '/tv/index.html') throw new Error('Use the base MyTube address, without a page path.');
      try { localStorage.setItem('mytube-server', url.origin); } catch { /* Opening still works without storage. */ }
      window.location.href = url.origin + '/tv/index.html';
    } catch (error) { document.getElementById('error').textContent = error.message || 'Check the server address.'; input.focus(); }
  };
  document.getElementById('exit').onclick = function () { window.close(); };
  document.addEventListener('keydown', function (event) {
    if (event.keyCode === 461 || event.keyCode === 27) { event.preventDefault(); window.close(); }
    if (event.keyCode >= 37 && event.keyCode <= 40 && !(document.activeElement === input && (event.keyCode === 37 || event.keyCode === 39))) {
      event.preventDefault(); var controls = [input, document.getElementById('open'), document.getElementById('exit')];
      var index = controls.indexOf(document.activeElement), direction = event.keyCode === 37 || event.keyCode === 38 ? -1 : 1;
      controls[(index + direction + controls.length) % controls.length].focus();
    }
  });
  (input.value ? document.getElementById('open') : input).focus();
}());
