const led        = document.getElementById('led');
const statusText = document.getElementById('statusText');
const timerEl    = document.getElementById('timer');
const btnOn      = document.getElementById('btnOn');
const btnOff     = document.getElementById('btnOff');
const duration   = document.getElementById('duration');
const message    = document.getElementById('message');

const savedDuration = localStorage.getItem('sr201_duration');
if (savedDuration) duration.value = savedDuration;
duration.addEventListener('change', () => localStorage.setItem('sr201_duration', duration.value));

let token = localStorage.getItem('sr201_token');
let ws = null;
let wsReconnectTimer = null;

let countdownEnd = null;
let countdownInterval = null;

function fmtTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function startCountdown(seconds) {
  clearInterval(countdownInterval);
  countdownEnd = Date.now() + seconds * 1000;
  function tick() {
    const rem = Math.max(0, Math.round((countdownEnd - Date.now()) / 1000));
    timerEl.textContent = fmtTime(rem);
    timerEl.className = 'timer active';
    if (rem === 0) stopCountdown();
  }
  tick();
  countdownInterval = setInterval(tick, 500);
}

function stopCountdown() {
  clearInterval(countdownInterval);
  countdownInterval = null;
  countdownEnd = null;
  timerEl.textContent = '—';
  timerEl.className = 'timer';
}

function connectWS() {
  if (ws) return;
  ws = new WebSocket(`wss://${location.host}/ws?token=${encodeURIComponent(token)}`);

  ws.onmessage = (e) => {
    try {
      const { state } = JSON.parse(e.data);
      if (state === 'on' || state === 'off') {
        setStatus(state);
        if (state === 'off') stopCountdown();
      }
    } catch {}
  };

  ws.onclose = () => {
    ws = null;
    if (token) wsReconnectTimer = setTimeout(connectWS, 3000);
  };
}

function disconnectWS() {
  clearTimeout(wsReconnectTimer);
  wsReconnectTimer = null;
  if (ws) { ws.close(); ws = null; }
  stopCountdown();
}

function showLogin() {
  token = null;
  localStorage.removeItem('sr201_token');
  disconnectWS();
  document.getElementById('loginCard').style.display = '';
  document.getElementById('remoteCard').style.display = 'none';
  document.getElementById('btnLogout').style.display = 'none';
  document.getElementById('loginError').textContent = '';
  document.getElementById('loginPassword').value = '';
}

function showApp() {
  document.getElementById('loginCard').style.display = 'none';
  document.getElementById('remoteCard').style.display = '';
  document.getElementById('btnLogout').style.display = '';
  connectWS();
}

async function tryLogin() {
  const pw    = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  const btnL  = document.getElementById('btnLogin');
  errEl.textContent = '';
  btnL.disabled = true;
  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (!res.ok) { errEl.textContent = 'Invalid password'; return; }
    const { token: t } = await res.json();
    token = t;
    localStorage.setItem('sr201_token', token);
    showApp();
  } catch {
    errEl.textContent = 'Connection error';
  } finally {
    btnL.disabled = false;
  }
}

document.getElementById('btnLogin').addEventListener('click', tryLogin);
document.getElementById('loginPassword').addEventListener('keydown', e => {
  if (e.key === 'Enter') tryLogin();
});
document.getElementById('btnLogout').addEventListener('click', showLogin);

if (token) { showApp(); } else { showLogin(); }

function setStatus(state) {
  led.className = 'led ' + state;
  statusText.className = 'status-text ' + state;
  statusText.textContent = state === 'on' ? 'ON' : state === 'off' ? 'OFF' : '—';
}

function setMessage(text, type = '') {
  message.textContent = text;
  message.className = 'message ' + type;
}

async function sendCommand(seconds) {
  btnOn.disabled = true;
  btnOff.disabled = true;
  setMessage('Sending…');

  try {
    const res = await fetch('/bridge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ seconds }),
    });

    if (res.status === 401) { showLogin(); setMessage('Session expired', 'error'); return; }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }

    if (seconds > 0) {
      setStatus('on');
      startCountdown(seconds);
      setMessage(`On for ${seconds}s`, 'success');
    } else {
      setStatus('off');
      stopCountdown();
      setMessage('Relay off', 'success');
    }
  } catch (err) {
    setMessage(err.message, 'error');
  } finally {
    btnOn.disabled = false;
    btnOff.disabled = false;
  }
}

btnOn.addEventListener('click', () => {
  const secs = parseInt(duration.value, 10);
  if (!secs || secs < 1) { setMessage('Enter a valid duration', 'error'); return; }
  sendCommand(secs);
});

btnOff.addEventListener('click', () => sendCommand(0));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
