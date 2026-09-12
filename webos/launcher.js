(function () {
  'use strict';
  var input = document.getElementById('server');
  var savedAddress = '', autoTimer;
  input.value = 'http://192.168.100.43:3090';
  try { savedAddress = localStorage.getItem('mytube-server') || ''; input.value = savedAddress || input.value; } catch { /* Storage may be disabled. */ }
  function cancelAutomatic() {
    clearTimeout(autoTimer); document.getElementById('automatic').textContent = 'Pas het adres aan en kies Open MyTube.';
  }
  input.oninput = cancelAutomatic;
  input.onfocus = cancelAutomatic;
  document.getElementById('change').onclick = function () { cancelAutomatic(); input.focus(); };
  document.getElementById('setup').onsubmit = function (event) {
    event.preventDefault();
    clearTimeout(autoTimer);
    try {
      var url = new URL(input.value.trim());
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error('Gebruik een HTTP- of HTTPS-adres zonder gebruikersnaam of wachtwoord.');
      if (url.pathname !== '/' && url.pathname !== '/tv' && url.pathname !== '/tv/' && url.pathname !== '/tv/index.html') throw new Error('Gebruik het MyTube-serveradres inclusief poort, zonder paginapad.');
      try { localStorage.setItem('mytube-server', url.origin); } catch { /* Opening still works without storage. */ }
      window.location.href = url.origin + '/tv/index.html';
    } catch (error) { document.getElementById('error').textContent = error.message || 'Controleer het serveradres.'; input.focus(); }
  };
  document.getElementById('exit').onclick = function () { cancelAutomatic(); window.close(); };
  document.addEventListener('keydown', function (event) {
    cancelAutomatic();
    if (event.keyCode === 461 || event.keyCode === 27) { event.preventDefault(); window.close(); }
    if (event.keyCode >= 37 && event.keyCode <= 40 && !(document.activeElement === input && (event.keyCode === 37 || event.keyCode === 39))) {
      event.preventDefault(); var controls = [input, document.getElementById('open'), document.getElementById('change'), document.getElementById('exit')];
      var index = controls.indexOf(document.activeElement), direction = event.keyCode === 37 || event.keyCode === 38 ? -1 : 1;
      controls[(index + direction + controls.length) % controls.length].focus();
    }
  });
  (input.value ? document.getElementById('open') : input).focus();
  if (savedAddress) {
    document.getElementById('automatic').textContent = 'Je opgeslagen server opent automatisch. Druk op een toets om het adres te wijzigen.';
    autoTimer = setTimeout(function () { document.getElementById('setup').onsubmit({ preventDefault: function () {} }); }, 2500);
  }
}());
