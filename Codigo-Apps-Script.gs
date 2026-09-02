/*************************************************************************************************
 * CENTRO DE GESTIÓN DE SOLICITUDES DE PRENSA — lógica de la aplicación
 *************************************************************************************************/
(function () {
'use strict';

/* ============================ ESTADO GLOBAL ============================ */
var CFG = {};                 // configuración efectiva (config.js + localStorage)
var DATA = [];                // solicitudes crudas
var charts = {};              // registro de gráficos Chart.js
var agendaVista = 'mes';
var agendaCursor = new Date();
var sortKey = 'inicioISO', sortDir = -1;
var syncTimer = null;

var ESTADOS = window.ESTADOS;
var TIPOS = window.TIPOS;
var LS_KEY = 'centroPrensaCfg';
var LS_DEMO_ESTADOS = 'centroPrensaDemoEstados';

/* ============================ UTILIDADES ============================ */
function $(s, c) { return (c || document).querySelector(s); }
function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
function ndef(v) { return (v == null || v === '' || v === 'No registrado') ? 'No registrado' : v; }
function tipoClass(t) { return 'tipo-' + String(t || '').replace(/\s+/g, '').replace(/[áà]/gi,'a').replace(/[é]/gi,'e').replace(/[í]/gi,'i').replace(/[ó]/gi,'o'); }

var MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
var DOW = ['dom','lun','mar','mié','jue','vie','sáb'];
var DOW_FULL = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

function fFecha(iso) { if (!iso) return 'No registrado'; var d = new Date(iso); return d.getDate() + ' ' + MESES[d.getMonth()].slice(0,3) + ' ' + d.getFullYear(); }
function fFechaLarga(iso) { if (!iso) return 'No registrado'; var d = new Date(iso); return d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear(); }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function startOfWeek(d) { var x = new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate() - x.getDay()); return x; }
function fmtISOdate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

/* ============================ CONFIGURACIÓN ============================ */
function loadConfig() {
  CFG = JSON.parse(JSON.stringify(window.APP_CONFIG));
  try {
    var saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    Object.keys(saved).forEach(function (k) { CFG[k] = saved[k]; });
  } catch (e) {}
}
function saveConfig() { try { localStorage.setItem(LS_KEY, JSON.stringify(CFG)); } catch (e) {} }

/* ============================ CAPA DE DATOS ============================ */
function apiUrl(params) {
  var u = CFG.API_URL;
  var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
  if (CFG.API_TOKEN) q.push('token=' + encodeURIComponent(CFG.API_TOKEN));
  return u + (u.indexOf('?') === -1 ? '?' : '&') + q.join('&');
}

function cargarSolicitudes() {
  if (CFG.MODO === 'demo') {
    var d = window.generarDatosDemo();
    // aplicar seguimiento guardado localmente en demo
    var st = {};
    try { st = JSON.parse(localStorage.getItem(LS_DEMO_ESTADOS) || '{}'); } catch (e) {}
    d.forEach(function (s) {
      if (st[s.id]) {
        var g = st[s.id];
        if (g.estado != null) s.estado = g.estado;
        if (g.delegado != null) s.delegado = g.delegado;
        if (g.entregado != null) s.entregado = g.entregado;
        if (g.fechaEntrega != null) s.fechaEntrega = g.fechaEntrega;
        s.estadoNota = g.nota || '';
      }
    });
    return Promise.resolve(d);
  }
  if (!CFG.API_URL) return Promise.reject(new Error('No hay URL de API configurada. Ve a Configuración.'));
  return fetch(apiUrl({ action: 'getSolicitudes' }), { method: 'GET' })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.error || 'Error del servidor.');
      return res.solicitudes || [];
    });
}

/* Aplica un cambio al registro en memoria (instantáneo) y devuelve el estado previo para revertir. */
function snapshotSeg(rec) { return { estado: rec.estado, delegado: rec.delegado, entregado: rec.entregado, fechaEntrega: rec.fechaEntrega }; }
function aplicarPatchLocal(rec, patch) {
  if (patch.estado != null) rec.estado = patch.estado;
  if (patch.delegado != null) rec.delegado = patch.delegado;
  if (patch.entregado != null) {
    if (patch.entregado && !rec.entregado) { rec.entregado = true; if (!rec.fechaEntrega) rec.fechaEntrega = new Date().toISOString(); }
    else if (!patch.entregado) { rec.entregado = false; rec.fechaEntrega = ''; }
  }
}

/* Persiste el estado ACTUAL del registro (ya modificado en memoria). No bloquea la interfaz. */
function persistir(id, patch) {
  var rec = DATA.filter(function (s) { return s.id === id; })[0];
  if (CFG.MODO === 'demo') {
    var st = {}; try { st = JSON.parse(localStorage.getItem(LS_DEMO_ESTADOS) || '{}'); } catch (e) {}
    st[id] = { estado: rec.estado, delegado: rec.delegado, entregado: rec.entregado, fechaEntrega: rec.fechaEntrega, nota: (st[id] && st[id].nota) || '' };
    try { localStorage.setItem(LS_DEMO_ESTADOS, JSON.stringify(st)); } catch (e) {}
    return Promise.resolve({ ok: true });
  }
  var params = { action: 'actualizar', id: id, usuario: 'dashboard' };
  if (patch.estado != null) params.estado = patch.estado;
  if (patch.delegado != null) params.delegado = patch.delegado;
  if (patch.entregado != null) params.entregado = patch.entregado ? 'true' : 'false';
  return fetch(apiUrl(params), { method: 'GET' })
    .then(function (r) { return r.json(); })
    .then(function (res) { if (!res.ok) throw new Error(res.error || 'No se pudo guardar.'); return res; });
}

/**
 * Cambia el seguimiento de forma OPTIMISTA: actualiza la pantalla al instante y guarda
 * en segundo plano. Si el guardado falla, revierte y avisa.
 */
function cambiarSeguimiento(id, patch, okMsg, reabrirDrawer) {
  var rec = DATA.filter(function (s) { return s.id === id; })[0];
  if (!rec) return;
  var prev = snapshotSeg(rec);
  aplicarPatchLocal(rec, patch);
  refrescarLigero();
  if (reabrirDrawer) abrirDrawer(id);
  if (okMsg) toast(okMsg, 'ok');
  persistir(id, patch).catch(function (err) {
    rec.estado = prev.estado; rec.delegado = prev.delegado; rec.entregado = prev.entregado; rec.fechaEntrega = prev.fechaEntrega;
    refrescarLigero(); if (reabrirDrawer) abrirDrawer(id);
    toast('⚠️ No se guardó: ' + err.message, 'err');
  });
}

/* ============================ ESTADO EFECTIVO ============================ */
function estadoEfectivo(s, now) {
  now = now || new Date();
  var manual = s.estado;
  if (manual === 'REALIZADA' || manual === 'NO_REALIZADA' || manual === 'CANCELADA') return manual;
  var fin = new Date(s.finISO || s.inicioISO || s.fechaServicio);
  if (!isNaN(fin.getTime()) && fin.getTime() < now.getTime()) return 'PENDIENTE';
  return 'PROGRAMADA';
}
function conEstado(list) {
  var now = new Date();
  return list.map(function (s) {
    if (s.delegado == null) s.delegado = '';
    if (s.entregado == null) s.entregado = false;
    if (s.fechaEntrega == null) s.fechaEntrega = '';
    s._estado = estadoEfectivo(s, now);
    return s;
  });
}
function esPasada(s) { var fin = new Date(s.finISO || s.inicioISO); return !isNaN(fin) && fin.getTime() < Date.now(); }

/* Tiempo de respuesta: horas entre la fecha de solicitud y la entrega del material. */
function tiempoRespuestaHoras(s) {
  if (!s.entregado || !s.fechaEntrega || !s.fechaCreacion) return null;
  var diff = new Date(s.fechaEntrega).getTime() - new Date(s.fechaCreacion).getTime();
  return diff > 0 ? diff / 3600000 : null;
}
function fmtDuracion(horas) {
  if (horas == null) return '—';
  if (horas < 1) return Math.max(1, Math.round(horas * 60)) + ' min';
  if (horas < 24) return (horas < 10 ? horas.toFixed(1) : Math.round(horas)) + ' h';
  var dias = horas / 24;
  return (dias < 10 ? dias.toFixed(1) : Math.round(dias)) + ' d';
}
function promedioRespuesta(list) {
  var vals = list.map(tiempoRespuestaHoras).filter(function (v) { return v != null; });
  if (!vals.length) return { prom: null, n: 0 };
  return { prom: vals.reduce(function (a, b) { return a + b; }, 0) / vals.length, n: vals.length };
}

/* ============================ RENDER: CHIPS ============================ */
function chipEstado(key) { var e = ESTADOS[key] || ESTADOS.PROGRAMADA; return '<span class="chip chip-' + key + '"><span class="dot"></span>' + e.label + '</span>'; }
function chipTipo(t) { var conf = TIPOS[t]; var emoji = conf ? conf.emoji : '📌'; return '<span class="tipo-chip ' + tipoClass(t) + '">' + emoji + ' ' + esc(t) + '</span>'; }

/* ============================ KPIs ============================ */
/* Filtro de fechas del dashboard (inicio) */
var dashDesde = '', dashHasta = '';
function datosDashboard() {
  return conEstado(DATA).filter(function (s) {
    var f = new Date(s.inicioISO);
    if (dashDesde && f < new Date(dashDesde + 'T00:00:00')) return false;
    if (dashHasta && f > new Date(dashHasta + 'T23:59:59')) return false;
    return true;
  });
}

function calcularKpis(list) {
  var now = new Date();
  var hoy = new Date(now); hoy.setHours(0,0,0,0);
  var finHoy = new Date(hoy); finHoy.setDate(finHoy.getDate() + 1);
  var iniSem = startOfWeek(now); var finSem = new Date(iniSem); finSem.setDate(finSem.getDate() + 7);
  var iniMes = new Date(now.getFullYear(), now.getMonth(), 1); var finMes = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  var full = conEstado(DATA);          // "hoy/semana/mes" son ventanas fijas: siempre sobre todo el conjunto
  var d = list || full;                 // el resto respeta el rango seleccionado
  function enRango(s, a, b) { var f = new Date(s.inicioISO); return f >= a && f < b; }
  var count = function (arr, fn) { return arr.filter(fn).length; };
  return {
    total: d.length,
    hoy: count(full, function (s) { return enRango(s, hoy, finHoy); }),
    semana: count(full, function (s) { return enRango(s, iniSem, finSem); }),
    mes: count(full, function (s) { return enRango(s, iniMes, finMes); }),
    programada: count(d, function (s) { return s._estado === 'PROGRAMADA'; }),
    pendiente: count(d, function (s) { return s._estado === 'PENDIENTE'; }),
    realizada: count(d, function (s) { return s._estado === 'REALIZADA'; }),
    noRealizada: count(d, function (s) { return s._estado === 'NO_REALIZADA'; }),
    cancelada: count(d, function (s) { return s._estado === 'CANCELADA'; }),
    entregado: count(d, function (s) { return s.entregado; }),
    respuesta: promedioRespuesta(d)
  };
}

function cumplimiento(list) {
  var d = list || conEstado(DATA);
  var pasadas = d.filter(function (s) { return esPasada(s) && s._estado !== 'CANCELADA'; });
  var real = pasadas.filter(function (s) { return s._estado === 'REALIZADA'; }).length;
  var pct = pasadas.length ? Math.round(real / pasadas.length * 100) : 0;
  return { pct: pct, base: pasadas.length, realizadas: real };
}

function renderDashboard() {
  var dd = datosDashboard();
  var k = calcularKpis(dd);
  var resp = k.respuesta.prom != null ? fmtDuracion(k.respuesta.prom) : '—';
  var cards = [
    ['Total de solicitudes', k.total, '', ''],
    ['Solicitudes de hoy', k.hoy, '', ''],
    ['Esta semana', k.semana, '', ''],
    ['Este mes', k.mes, '', ''],
    ['Programadas', k.programada, 'st-prog', '🟡'],
    ['Pendientes de verificación', k.pendiente, 'st-pend', '🔵'],
    ['Realizadas', k.realizada, 'st-real', '🟢'],
    ['No realizadas', k.noRealizada, 'st-nore', '🔴'],
    ['Canceladas', k.cancelada, 'st-canc', '⚪'],
    ['Material entregado', k.entregado, 'st-real', '📦'],
    ['Tiempo de respuesta prom.', resp, '', '⏱️', k.respuesta.n + ' entregas medidas']
  ];
  var g = el('div', 'kpi-grid');
  cards.forEach(function (c) {
    var e = el('div', 'kpi ' + (c[2] || ''));
    e.innerHTML = '<div class="k-label">' + (c[3] ? c[3] + ' ' : '') + c[0] + '</div><div class="k-value">' + c[1] + '</div>' + (c[4] ? '<div class="k-foot">' + c[4] + '</div>' : '');
    g.appendChild(e);
  });
  var host = $('#dashKpis'); host.innerHTML = ''; host.appendChild(g);

  // Etiqueta de rango activo
  $('#dashRangoLbl').textContent = (dashDesde || dashHasta) ? ('Periodo: ' + (dashDesde ? fFecha(dashDesde + 'T00:00:00') : '…') + ' – ' + (dashHasta ? fFecha(dashHasta + 'T00:00:00') : '…')) : '';

  // Cumplimiento (sobre el rango)
  var cm = cumplimiento(dd);
  var u = CFG.CUMPLIMIENTO_UMBRALES;
  var nivel = cm.pct >= u.alto ? { c: 'var(--st-real)', t: '🟢 Alto cumplimiento', bg: '#DEF3EA', col: '#0F7A50' }
    : cm.pct >= u.medio ? { c: 'var(--st-prog)', t: '🟡 Cumplimiento medio', bg: '#FCF1DE', col: '#9A6714' }
      : { c: 'var(--st-nore)', t: '🔴 Bajo cumplimiento', bg: '#FCE4E5', col: '#B4292D' };
  $('#cumplPanel').innerHTML =
    '<div class="cumpl-card">' +
      '<div class="gauge" style="--p:' + cm.pct + ';--c:' + nivel.c + '"><div class="g-inner"><div class="g-num">' + cm.pct + '%</div><div class="g-lbl">cumplimiento</div></div></div>' +
      '<div class="cumpl-text"><h3>Porcentaje de cumplimiento</h3>' +
      '<p>' + cm.realizadas + ' solicitudes realizadas de ' + cm.base + ' cuya fecha ya pasó (se excluyen las canceladas).</p>' +
      '<span class="cumpl-badge" style="background:' + nivel.bg + ';color:' + nivel.col + '">' + nivel.t + '</span></div>' +
    '</div>';

  // Pendientes (resumen en dashboard) — siempre sobre todo el conjunto
  var pend = conEstado(DATA).filter(function (s) { return s._estado === 'PENDIENTE'; })
    .sort(function (a, b) { return new Date(a.inicioISO) - new Date(b.inicioISO); });
  $('#pendCountTitle').textContent = pend.length;
  renderPendingList($('#dashPending'), pend.slice(0, 4), true);

  // Agenda de hoy
  renderHoy();
  renderUpcomingMini();

  // Gráficos dashboard (respetan el rango)
  chartTipo('chTipoDash', dd);
  chartEstado('chEstadoDash', dd);
}

/* ============================ PENDIENTES ============================ */
function opcionesDelegado(sel) {
  var opts = '<option value="">— Delegar a —</option>';
  (window.DELEGADOS || []).forEach(function (nom) { opts += '<option value="' + nom + '"' + (sel === nom ? ' selected' : '') + '>' + nom + '</option>'; });
  return opts;
}

function renderPendingList(host, items, compact) {
  host.innerHTML = '';
  if (!items.length) { host.innerHTML = '<div class="empty"><span class="big">✅</span>No hay solicitudes pendientes de verificación.</div>'; return; }
  items.forEach(function (s) {
    var e = el('div', 'pending-item');
    e.innerHTML =
      '<div class="pi-main">' +
        '<div class="pi-title">' + chipTipo(s.tipo) + ' ' + esc(ndef(s.nombre)) + '</div>' +
        '<div class="pi-meta">' +
          '<span>📅 ' + fFecha(s.inicioISO) + ' · ' + esc(s.horaInicio || '') + '</span>' +
          '<span>🏷️ ' + esc(ndef(s.programa)) + '</span>' +
          (s.tipo === 'Cubrimiento' ? '<span>📍 ' + esc(ndef(s.lugar)) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="pi-actions">' +
        '<select class="deleg-select' + (s.delegado ? ' set' : '') + '">' + opcionesDelegado(s.delegado) + '</select>' +
        '<label class="entrega-check' + (s.entregado ? ' on' : '') + '"><input type="checkbox"' + (s.entregado ? ' checked' : '') + '> 📦 Material entregado</label>' +
        '<button class="qbtn ok" data-act="REALIZADA">✓ Realizada</button>' +
        '<button class="qbtn no" data-act="NO_REALIZADA">✕ No realizada</button>' +
        '<button class="qbtn cancel" data-act="CANCELADA">Cancelar</button>' +
      '</div>';
    e.querySelectorAll('.qbtn').forEach(function (b) {
      b.addEventListener('click', function () { accionEstado(s.id, b.getAttribute('data-act')); });
    });
    e.querySelector('.deleg-select').addEventListener('change', function () {
      cambiarSeguimiento(s.id, { delegado: this.value }, this.value ? ('👤 Delegado a ' + this.value + '.') : 'Delegación quitada.');
    });
    e.querySelector('.entrega-check input').addEventListener('change', function () {
      var chk = this.checked;
      cambiarSeguimiento(s.id, { entregado: chk }, chk ? '📦 Material marcado como entregado.' : 'Entrega desmarcada.');
    });
    e.querySelector('.pi-main').addEventListener('click', function () { abrirDrawer(s.id); });
    e.querySelector('.pi-main').style.cursor = 'pointer';
    host.appendChild(e);
  });
}

function renderPendientesFull() {
  var pend = conEstado(DATA).filter(function (s) { return s._estado === 'PENDIENTE'; })
    .sort(function (a, b) { return new Date(a.inicioISO) - new Date(b.inicioISO); });
  $('#pendTotal').textContent = pend.length;
  renderPendingList($('#pendingFull'), pend, false);
}

function accionEstado(id, estado) {
  cambiarSeguimiento(id, { estado: estado }, ESTADOS[estado].emoji + ' Solicitud marcada como ' + ESTADOS[estado].label.toLowerCase() + '.');
}

/* ============================ AGENDA DE HOY / PRÓXIMAS ============================ */
function renderHoy() {
  var now = new Date();
  $('#todayDate').textContent = fFechaLarga(now.toISOString());
  var hoy = conEstado(DATA).filter(function (s) { return sameDay(new Date(s.inicioISO), now); })
    .sort(function (a, b) { return (a.horaInicio || '').localeCompare(b.horaInicio || ''); });
  var host = $('#todayAgenda');
  if (!hoy.length) { host.innerHTML = '<div class="empty"><span class="big">☕</span>Sin solicitudes programadas para hoy.</div>'; return; }
  var grupos = { 'Cubrimiento': [], 'Pieza gráfica': [], 'Grabación de video': [] };
  hoy.forEach(function (s) { (grupos[s.tipo] || (grupos[s.tipo] = [])).push(s); });
  host.innerHTML = '';
  Object.keys(grupos).forEach(function (t) {
    if (!grupos[t].length) return;
    var wrap = el('div'); wrap.style.marginBottom = '12px';
    wrap.innerHTML = '<div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:6px">' + chipTipo(t) + '</div>';
    grupos[t].forEach(function (s) {
      var r = el('div');
      r.style.cssText = 'display:flex;gap:10px;padding:7px 0;border-bottom:1px solid #F0F3F5;cursor:pointer;font-size:13px';
      r.innerHTML = '<span style="font-family:var(--font-num);color:var(--petrol);flex:0 0 46px">' + esc(s.horaInicio || '--:--') + '</span>' +
        '<span style="flex:1">' + esc(ndef(s.nombre)) + ' <span style="color:var(--faint)">· ' + esc(ndef(s.telefono)) + '</span></span>' + chipEstado(s._estado);
      r.addEventListener('click', function () { abrirDrawer(s.id); });
      wrap.appendChild(r);
    });
    host.appendChild(wrap);
  });
}

function renderUpcomingMini() {
  var now = new Date(); var lim = new Date(now); lim.setDate(lim.getDate() + 7);
  var prox = conEstado(DATA).filter(function (s) { var f = new Date(s.inicioISO); return f >= now && f <= lim && s._estado === 'PROGRAMADA'; })
    .sort(function (a, b) { return new Date(a.inicioISO) - new Date(b.inicioISO); }).slice(0, 8);
  var host = $('#upcomingMini');
  if (!prox.length) { host.innerHTML = '<div class="empty"><span class="big">📭</span>Sin solicitudes en los próximos 7 días.</div>'; return; }
  host.innerHTML = '';
  prox.forEach(function (s) {
    var r = el('div');
    r.style.cssText = 'display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #F0F3F5;cursor:pointer;font-size:13px';
    r.innerHTML = '<span style="font-family:var(--font-num);color:var(--petrol);flex:0 0 86px">' + fFecha(s.inicioISO) + '</span>' +
      chipTipo(s.tipo) + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(ndef(s.nombre)) + '</span>' +
      '<span style="font-family:var(--font-num);color:var(--muted)">' + esc(s.horaInicio || '') + '</span>';
    r.addEventListener('click', function () { abrirDrawer(s.id); });
    host.appendChild(r);
  });
}

/* ============================ AGENDA (CALENDARIO) ============================ */
function renderAgenda() {
  var d = conEstado(DATA);
  var host = $('#agendaBody');
  if (agendaVista === 'mes') { $('#agLabel').textContent = MESES[agendaCursor.getMonth()] + ' ' + agendaCursor.getFullYear(); host.innerHTML = ''; host.appendChild(vistaMes(d)); }
  else if (agendaVista === 'semana') { renderSemana(host, d); }
  else if (agendaVista === 'dia') { renderDia(host, d); }
  else { renderListaAgenda(host, d); }
}

function evColor(s) {
  if (s._estado === 'REALIZADA') return 'var(--st-real)';
  if (s._estado === 'NO_REALIZADA') return 'var(--st-nore)';
  if (s._estado === 'PENDIENTE') return 'var(--st-pend)';
  return (TIPOS[s.tipo] && TIPOS[s.tipo].color) || '#64748b';
}

function vistaMes(d) {
  var grid = el('div', 'cal-grid');
  ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].forEach(function (n) { grid.appendChild(el('div', 'dow', n)); });
  var first = new Date(agendaCursor.getFullYear(), agendaCursor.getMonth(), 1);
  var start = new Date(first); start.setDate(1 - first.getDay());
  var now = new Date();
  for (var i = 0; i < 42; i++) {
    let day = new Date(start); day.setDate(start.getDate() + i);
    var cell = el('div', 'cal-cell' + (day.getMonth() !== agendaCursor.getMonth() ? ' other' : '') + (sameDay(day, now) ? ' today' : ''));
    cell.appendChild(el('div', 'daynum', String(day.getDate())));
    var evs = d.filter(function (s) { return sameDay(new Date(s.inicioISO), day); })
      .sort(function (a, b) { return (a.horaInicio || '').localeCompare(b.horaInicio || ''); });
    evs.slice(0, 3).forEach(function (s) { cell.appendChild(evChip(s)); });
    if (evs.length > 3) { var m = el('div', 'ev-more', '+' + (evs.length - 3) + ' más'); m.addEventListener('click', function () { agendaVista = 'dia'; agendaCursor = new Date(day); $$('#agendaViews button').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-av') === 'dia'); }); renderAgenda(); }); cell.appendChild(m); }
    grid.appendChild(cell);
  }
  return grid;
}
function evChip(s) {
  var e = el('div', 'ev' + (s._estado === 'REALIZADA' || s._estado === 'CANCELADA' ? ' done' : ''));
  e.style.background = evColor(s);
  e.innerHTML = '<span class="evtime">' + esc(s.horaInicio || '') + '</span><span class="txt">' + esc(ndef(s.nombre)) + '</span>';
  e.addEventListener('click', function () { abrirDrawer(s.id); });
  return e;
}

function renderSemana(host, d) {
  var ini = startOfWeek(agendaCursor); var fin = new Date(ini); fin.setDate(fin.getDate() + 6);
  $('#agLabel').textContent = ini.getDate() + ' ' + MESES[ini.getMonth()].slice(0,3) + ' – ' + fin.getDate() + ' ' + MESES[fin.getMonth()].slice(0,3);
  var wrap = el('div', 'cal-grid');
  var now = new Date();
  for (var i = 0; i < 7; i++) { var day = new Date(ini); day.setDate(ini.getDate() + i); wrap.appendChild(el('div', 'dow', DOW_FULL[i].slice(0,3) + ' ' + day.getDate())); }
  for (var j = 0; j < 7; j++) {
    (function (j) {
      var day = new Date(ini); day.setDate(ini.getDate() + j);
      var cell = el('div', 'cal-cell' + (sameDay(day, now) ? ' today' : '')); cell.style.minHeight = '200px';
      var evs = d.filter(function (s) { return sameDay(new Date(s.inicioISO), day); }).sort(function (a, b) { return (a.horaInicio || '').localeCompare(b.horaInicio || ''); });
      evs.forEach(function (s) { cell.appendChild(evChip(s)); });
      if (!evs.length) cell.appendChild(el('div', '', '<span style="font-size:11px;color:#C3CDD3">—</span>'));
      wrap.appendChild(cell);
    })(j);
  }
  host.innerHTML = ''; host.appendChild(wrap);
}

function renderDia(host, d) {
  var day = new Date(agendaCursor);
  $('#agLabel').textContent = DOW_FULL[day.getDay()] + ' ' + day.getDate() + ' ' + MESES[day.getMonth()].slice(0,3);
  var evs = d.filter(function (s) { return sameDay(new Date(s.inicioISO), day); }).sort(function (a, b) { return (a.horaInicio || '').localeCompare(b.horaInicio || ''); });
  if (!evs.length) { host.innerHTML = '<div class="card"><div class="empty"><span class="big">🗓️</span>Sin solicitudes este día.</div></div>'; return; }
  var list = el('div', 'day-list');
  evs.forEach(function (s) {
    var row = el('div', 'day-row');
    row.innerHTML = '<div class="dr-time">' + esc(s.horaInicio || '--:--') + '</div><div class="dr-events"></div>';
    var box = el('div');
    box.style.cssText = 'display:flex;align-items:center;gap:10px;cursor:pointer;padding:4px 0';
    box.innerHTML = chipTipo(s.tipo) + '<strong style="flex:1">' + esc(ndef(s.nombre)) + '</strong>' + chipEstado(s._estado);
    box.addEventListener('click', function () { abrirDrawer(s.id); });
    row.querySelector('.dr-events').appendChild(box);
    list.appendChild(row);
  });
  host.innerHTML = ''; host.appendChild(list);
}

function renderListaAgenda(host, d) {
  $('#agLabel').textContent = 'Todas';
  var evs = d.slice().sort(function (a, b) { return new Date(a.inicioISO) - new Date(b.inicioISO); });
  if (!evs.length) { host.innerHTML = '<div class="card"><div class="empty">Sin solicitudes.</div></div>'; return; }
  var card = el('div', 'card'); var body = el('div');
  evs.forEach(function (s) {
    var r = el('div', 'agenda-list-item');
    r.innerHTML = '<span class="ali-date">' + fFecha(s.inicioISO) + '</span>' +
      '<span style="font-family:var(--font-num);color:var(--muted);flex:0 0 44px">' + esc(s.horaInicio || '') + '</span>' +
      chipTipo(s.tipo) + '<strong style="flex:1">' + esc(ndef(s.nombre)) + '</strong>' +
      '<span style="color:var(--muted);font-size:12px">' + esc(ndef(s.programa)) + '</span>' + chipEstado(s._estado);
    r.addEventListener('click', function () { abrirDrawer(s.id); });
    body.appendChild(r);
  });
  card.appendChild(body); host.innerHTML = ''; host.appendChild(card);
}

/* ============================ TABLA GENERAL ============================ */
function filtrosTabla() {
  return {
    q: ($('#tblSearch').value || '').toLowerCase().trim(),
    estado: $('#fltEstado').value, tipo: $('#fltTipo').value, programa: $('#fltPrograma').value,
    lugar: $('#fltLugar').value, desde: $('#fltDesde').value, hasta: $('#fltHasta').value
  };
}
function aplicarFiltros(d, f) {
  return d.filter(function (s) {
    if (f.estado && s._estado !== f.estado) return false;
    if (f.tipo && s.tipo !== f.tipo) return false;
    if (f.programa && s.programa !== f.programa) return false;
    if (f.lugar && s.lugar !== f.lugar) return false;
    if (f.desde && new Date(s.inicioISO) < new Date(f.desde + 'T00:00:00')) return false;
    if (f.hasta && new Date(s.inicioISO) > new Date(f.hasta + 'T23:59:59')) return false;
    if (f.q) {
      var blob = [s.nombre, s.programa, s.lugar, s.correo, s.telefono, s.tipo, s.descripcionPieza].join(' ').toLowerCase();
      if (blob.indexOf(f.q) === -1) return false;
    }
    return true;
  });
}
function renderTabla() {
  var d = conEstado(DATA);
  var f = filtrosTabla();
  var rows = aplicarFiltros(d, f);
  rows.sort(function (a, b) {
    var va = a[sortKey] || '', vb = b[sortKey] || '';
    if (sortKey === 'inicioISO') { va = new Date(a.inicioISO).getTime(); vb = new Date(b.inicioISO).getTime(); }
    if (sortKey === 'estado') { va = a._estado; vb = b._estado; }
    return (va < vb ? -1 : va > vb ? 1 : 0) * sortDir;
  });
  var body = $('#mainTableBody'); body.innerHTML = '';
  if (!rows.length) { body.innerHTML = '<tr><td colspan="10"><div class="empty">Sin resultados con los filtros actuales.</div></td></tr>'; }
  rows.forEach(function (s) {
    var lugarDesc = s.tipo === 'Pieza gráfica' ? esc(ndef(s.descripcionPieza)) : esc(ndef(s.lugar));
    var deleg = s.delegado ? '<span class="deleg-tag ' + s.delegado + '">👤 ' + esc(s.delegado) + '</span>' : '<span style="color:var(--faint)">—</span>';
    var entreg = s.entregado ? '<span class="entregado-badge">📦 Sí</span>' : '<span style="color:var(--faint)">No</span>';
    var tr = el('tr', 'row-click');
    tr.innerHTML =
      '<td class="num">' + fFecha(s.inicioISO) + '</td>' +
      '<td class="num">' + esc(s.horaInicio || '—') + '</td>' +
      '<td>' + esc(ndef(s.nombre)) + '</td>' +
      '<td>' + esc(ndef(s.programa)) + '</td>' +
      '<td style="font-size:12px;color:var(--muted)">' + esc(ndef(s.telefono)) + '<br>' + esc(ndef(s.correo)) + '</td>' +
      '<td>' + chipTipo(s.tipo) + '</td>' +
      '<td class="desc-cell">' + lugarDesc + '</td>' +
      '<td>' + deleg + '</td>' +
      '<td>' + entreg + '</td>' +
      '<td>' + chipEstado(s._estado) + '</td>';
    tr.addEventListener('click', function () { abrirDrawer(s.id); });
    body.appendChild(tr);
  });
  $('#tblCount').textContent = rows.length + ' de ' + d.length + ' solicitudes';
  window._tablaFiltrada = rows;
}

/* ============================ MÓDULOS DE SERVICIO ============================ */
function miniKpi(label, val) { return '<div class="mini-kpi"><div class="mk-v">' + val + '</div><div class="mk-l">' + label + '</div></div>'; }
function statsTipo(tipo) {
  var d = conEstado(DATA).filter(function (s) { return s.tipo === tipo; });
  var c = function (st) { return d.filter(function (s) { return s._estado === st; }).length; };
  return { total: d.length, prog: c('PROGRAMADA'), real: c('REALIZADA'), nore: c('NO_REALIZADA'), pend: c('PENDIENTE'), lista: d };
}
function renderModulo(tipo, kpiHost, tableId, extraCols) {
  var s = statsTipo(tipo);
  $(kpiHost).innerHTML = [
    miniKpi('Total', s.total), miniKpi('Programadas', s.prog), miniKpi('Realizadas', s.real),
    miniKpi('No realizadas', s.nore), miniKpi('Pendientes', s.pend)
  ].join('');
  var body = $(tableId); body.innerHTML = '';
  var list = s.lista.sort(function (a, b) { return new Date(b.inicioISO) - new Date(a.inicioISO); });
  if (!list.length) { body.innerHTML = '<tr><td colspan="6"><div class="empty">Sin registros.</div></td></tr>'; return s; }
  list.forEach(function (r) {
    var tr = el('tr', 'row-click'); tr.innerHTML = extraCols(r); tr.addEventListener('click', function () { abrirDrawer(r.id); }); body.appendChild(tr);
  });
  return s;
}
function renderCubrimientos() {
  var s = renderModulo('Cubrimiento', '#cubKpis', '#cubTable', function (r) {
    return '<td class="num">' + fFecha(r.inicioISO) + '</td><td>' + esc(ndef(r.nombre)) + '</td><td>' + esc(ndef(r.programa)) + '</td><td>' + esc(ndef(r.lugar)) + '</td><td>' + chipEstado(r._estado) + '</td>';
  });
  chartLugares('chLugares'); chartCubEstado('chCubEstado');
  return s;
}
function renderPiezas() {
  renderModulo('Pieza gráfica', '#pzaKpis', '#pzaTable', function (r) {
    return '<td class="num">' + fFecha(r.inicioISO) + '</td><td>' + esc(ndef(r.nombre)) + '</td><td>' + esc(ndef(r.programa)) + '</td><td class="desc-cell" style="max-width:340px">' + esc(ndef(r.descripcionPieza)) + '</td><td>' + chipEstado(r._estado) + '</td>';
  });
}
function renderVideos() {
  renderModulo('Grabación de video', '#vidKpis', '#vidTable', function (r) {
    return '<td class="num">' + fFecha(r.inicioISO) + '</td><td class="num">' + esc(r.horaInicio || '—') + '</td><td>' + esc(ndef(r.nombre)) + '</td><td>' + esc(ndef(r.programa)) + '</td><td>' + esc(ndef(r.lugar)) + '</td><td>' + chipEstado(r._estado) + '</td>';
  });
}

/* ============================ GRÁFICOS ============================ */
function destroyChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }
function baseOpts(extra) { return Object.assign({ responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { family: 'Inter', size: 11 } } } } }, extra || {}); }
function mkChart(id, cfg) { var c = document.getElementById(id); if (!c) return; destroyChart(id); charts[id] = new Chart(c.getContext('2d'), cfg); }

function chartTipo(id, list) {
  var d = list || conEstado(DATA); var labels = Object.keys(TIPOS);
  var vals = labels.map(function (t) { return d.filter(function (s) { return s.tipo === t; }).length; });
  mkChart(id, { type: 'doughnut', data: { labels: labels, datasets: [{ data: vals, backgroundColor: labels.map(function (t) { return TIPOS[t].color; }), borderWidth: 2, borderColor: '#fff' }] }, options: baseOpts({ cutout: '62%', plugins: { legend: { position: 'bottom' } } }) });
}
function chartEstado(id, list) {
  var d = list || conEstado(DATA); var keys = ['PROGRAMADA','PENDIENTE','REALIZADA','NO_REALIZADA','CANCELADA'];
  var vals = keys.map(function (k) { return d.filter(function (s) { return s._estado === k; }).length; });
  mkChart(id, { type: 'doughnut', data: { labels: keys.map(function (k) { return ESTADOS[k].label; }), datasets: [{ data: vals, backgroundColor: keys.map(function (k) { return ESTADOS[k].color; }), borderWidth: 2, borderColor: '#fff' }] }, options: baseOpts({ cutout: '62%', plugins: { legend: { position: 'bottom' } } }) });
}
function chartPrograma(id) {
  var d = conEstado(DATA); var map = {};
  d.forEach(function (s) { var p = ndef(s.programa); map[p] = (map[p] || 0) + 1; });
  var entries = Object.keys(map).map(function (k) { return [k, map[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
  mkChart(id, { type: 'bar', data: { labels: entries.map(function (e) { return e[0]; }), datasets: [{ label: 'Solicitudes', data: entries.map(function (e) { return e[1]; }), backgroundColor: '#0F6E7B', borderRadius: 6 }] }, options: baseOpts({ indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }) });
}
function chartMes(id) {
  var d = conEstado(DATA); var map = {};
  d.forEach(function (s) { var dt = new Date(s.inicioISO); var k = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0'); map[k] = (map[k] || 0) + 1; });
  var keys = Object.keys(map).sort();
  mkChart(id, { type: 'line', data: { labels: keys.map(function (k) { var p = k.split('-'); return MESES[+p[1] - 1].slice(0,3) + ' ' + p[0].slice(2); }), datasets: [{ label: 'Solicitudes', data: keys.map(function (k) { return map[k]; }), borderColor: '#0F6E7B', backgroundColor: 'rgba(15,110,123,.12)', fill: true, tension: .3, pointRadius: 4, pointBackgroundColor: '#0F6E7B' }] }, options: baseOpts({ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }) });
}
function chartDow(id) {
  var d = conEstado(DATA); var counts = [0,0,0,0,0,0,0];
  d.forEach(function (s) { counts[new Date(s.inicioISO).getDay()]++; });
  mkChart(id, { type: 'bar', data: { labels: DOW_FULL, datasets: [{ label: 'Solicitudes', data: counts, backgroundColor: '#C99B3F', borderRadius: 6 }] }, options: baseOpts({ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }) });
}
function chartCumplMes(id) {
  var d = conEstado(DATA); var map = {};
  d.filter(function (s) { return esPasada(s) && s._estado !== 'CANCELADA'; }).forEach(function (s) {
    var dt = new Date(s.inicioISO); var k = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
    if (!map[k]) map[k] = { r: 0, t: 0 }; map[k].t++; if (s._estado === 'REALIZADA') map[k].r++;
  });
  var keys = Object.keys(map).sort();
  mkChart(id, { type: 'bar', data: { labels: keys.map(function (k) { var p = k.split('-'); return MESES[+p[1] - 1].slice(0,3) + ' ' + p[0].slice(2); }), datasets: [{ label: '% cumplimiento', data: keys.map(function (k) { return Math.round(map[k].r / map[k].t * 100); }), backgroundColor: '#1FA971', borderRadius: 6 }] }, options: baseOpts({ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: function (v) { return v + '%'; } } } } }) });
}
function chartLugares(id) {
  var d = conEstado(DATA).filter(function (s) { return s.tipo === 'Cubrimiento'; }); var map = {};
  d.forEach(function (s) { var l = ndef(s.lugar); if (l === 'No registrado') return; map[l] = (map[l] || 0) + 1; });
  var entries = Object.keys(map).map(function (k) { return [k, map[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
  mkChart(id, { type: 'bar', data: { labels: entries.map(function (e) { return e[0]; }), datasets: [{ label: 'Cubrimientos', data: entries.map(function (e) { return e[1]; }), backgroundColor: '#2E86AB', borderRadius: 6 }] }, options: baseOpts({ indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }) });
}
function chartCubEstado(id) {
  var d = conEstado(DATA).filter(function (s) { return s.tipo === 'Cubrimiento'; }); var keys = ['PROGRAMADA','PENDIENTE','REALIZADA','NO_REALIZADA','CANCELADA'];
  mkChart(id, { type: 'doughnut', data: { labels: keys.map(function (k) { return ESTADOS[k].label; }), datasets: [{ data: keys.map(function (k) { return d.filter(function (s) { return s._estado === k; }).length; }), backgroundColor: keys.map(function (k) { return ESTADOS[k].color; }), borderWidth: 2, borderColor: '#fff' }] }, options: baseOpts({ cutout: '62%', plugins: { legend: { position: 'bottom' } } }) });
}

function renderAnalisis() {
  chartPrograma('chPrograma'); chartTipo('chTipo'); chartMes('chMes'); chartDow('chDow'); chartEstado('chEstado'); chartCumplMes('chCumpl');
  renderCarga(); renderRespuesta(); renderAlertas(); renderAnalisisPrograma();
}

function renderRespuesta() {
  var d = conEstado(DATA);
  var global = promedioRespuesta(d);
  var cards = [];
  cards.push(miniKpi('Promedio general', global.prom != null ? fmtDuracion(global.prom) : '—'));
  cards.push(miniKpi('Entregas medidas', global.n));
  Object.keys(TIPOS).forEach(function (t) {
    var r = promedioRespuesta(d.filter(function (s) { return s.tipo === t; }));
    cards.push(miniKpi(TIPOS[t].emoji + ' ' + t, r.prom != null ? fmtDuracion(r.prom) : '—'));
  });
  (window.DELEGADOS || []).forEach(function (nom) {
    var r = promedioRespuesta(d.filter(function (s) { return s.delegado === nom; }));
    cards.push(miniKpi('👤 ' + nom, r.prom != null ? fmtDuracion(r.prom) : '—'));
  });
  $('#respCards').innerHTML = cards.join('');
}

/* ============================ ANÁLISIS POR PROGRAMA ============================ */
function renderAnalisisPrograma() {
  var prog = $('#anProg').value;
  var d = conEstado(DATA).filter(function (s) { return !prog || s.programa === prog; });
  var c = function (fn) { return d.filter(fn).length; };
  $('#anProgKpis').innerHTML = [
    miniKpi('Total', d.length),
    miniKpi('📸 Cubrimientos', c(function (s) { return s.tipo === 'Cubrimiento'; })),
    miniKpi('🎨 Piezas', c(function (s) { return s.tipo === 'Pieza gráfica'; })),
    miniKpi('🎥 Videos', c(function (s) { return s.tipo === 'Grabación de video'; })),
    miniKpi('🟢 Realizadas', c(function (s) { return s._estado === 'REALIZADA'; })),
    miniKpi('🔴 No realizadas', c(function (s) { return s._estado === 'NO_REALIZADA'; })),
    miniKpi('🔵 Pendientes', c(function (s) { return s._estado === 'PENDIENTE'; }))
  ].join('');
}

/* ============================ CARGA DE TRABAJO ============================ */
function pesoDe(s) { return CFG.PONDERACIONES[s.tipo] || 0; }
function renderCarga() {
  var now = new Date();
  var iniSem = startOfWeek(now); var finSem = new Date(iniSem); finSem.setDate(finSem.getDate() + 7);
  var iniMes = new Date(now.getFullYear(), now.getMonth(), 1); var finMes = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  var d = conEstado(DATA).filter(function (s) { return s._estado !== 'CANCELADA'; });
  var enRango = function (s, a, b) { var f = new Date(s.inicioISO); return f >= a && f < b; };
  var cargaSem = d.filter(function (s) { return enRango(s, iniSem, finSem); }).reduce(function (a, s) { return a + pesoDe(s); }, 0);
  var cargaMes = d.filter(function (s) { return enRango(s, iniMes, finMes); }).reduce(function (a, s) { return a + pesoDe(s); }, 0);
  var u = CFG.CARGA_UMBRALES;
  function light(v) { return v >= u.alta ? 'high' : v >= u.media ? 'med' : 'low'; }
  function txt(v) { return v >= u.alta ? '🔴 Carga alta' : v >= u.media ? '🟡 Carga media' : '🟢 Carga baja'; }

  var porTipo = Object.keys(TIPOS).map(function (t) {
    var pts = d.filter(function (s) { return s.tipo === t && enRango(s, iniSem, finSem); }).reduce(function (a, s) { return a + pesoDe(s); }, 0);
    return '<div class="load-card"><div class="lc-top"><span class="lc-label">' + TIPOS[t].emoji + ' ' + t + '</span></div><div class="lc-value">' + pts + '</div><div class="lc-foot">puntos esta semana</div></div>';
  }).join('');

  // Carga por programa (semana)
  var mapProg = {};
  d.filter(function (s) { return enRango(s, iniSem, finSem); }).forEach(function (s) { var p = ndef(s.programa); mapProg[p] = (mapProg[p] || 0) + pesoDe(s); });
  var topProg = Object.keys(mapProg).map(function (k) { return [k, mapProg[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 3);
  var progCards = topProg.map(function (e) { return '<div class="load-card"><div class="lc-top"><span class="lc-label">🏷️ ' + esc(e[0]) + '</span><span class="lc-light light-' + light(e[1]) + '"></span></div><div class="lc-value">' + e[1] + '</div><div class="lc-foot">puntos · semana</div></div>'; }).join('');

  $('#loadCards').innerHTML =
    '<div class="load-card"><div class="lc-top"><span class="lc-label">Carga semanal</span><span class="lc-light light-' + light(cargaSem) + '"></span></div><div class="lc-value">' + cargaSem + '</div><div class="lc-foot">' + txt(cargaSem) + '</div></div>' +
    '<div class="load-card"><div class="lc-top"><span class="lc-label">Carga mensual</span><span class="lc-light light-' + light(cargaMes / 4) + '"></span></div><div class="lc-value">' + cargaMes + '</div><div class="lc-foot">puntos acumulados</div></div>' +
    porTipo + progCards;
}

/* ============================ ALERTAS ============================ */
function renderAlertas() {
  var d = conEstado(DATA); var now = new Date();
  function futuras(hrs) { var lim = new Date(now.getTime() + hrs * 3600000); return d.filter(function (s) { var f = new Date(s.inicioISO); return f >= now && f <= lim && s._estado === 'PROGRAMADA'; }).sort(function (a, b) { return new Date(a.inicioISO) - new Date(b.inicioISO); }); }
  var p24 = futuras(24), p3 = futuras(72), p7 = futuras(168);
  var pend = d.filter(function (s) { return s._estado === 'PENDIENTE'; });

  // alta concentración
  var mapDia = {};
  d.filter(function (s) { return new Date(s.inicioISO) >= now; }).forEach(function (s) { var k = new Date(s.inicioISO).toDateString(); (mapDia[k] = mapDia[k] || []).push(s); });
  var concentra = Object.keys(mapDia).filter(function (k) { return mapDia[k].length >= 4; }).map(function (k) { return { fecha: new Date(k), n: mapDia[k].length }; }).sort(function (a, b) { return a.fecha - b.fecha; });

  // poca anticipación (creada < 24h antes del servicio)
  var pocaAntic = d.filter(function (s) { if (!s.fechaCreacion) return false; var diff = new Date(s.inicioISO) - new Date(s.fechaCreacion); return diff > 0 && diff < 24 * 3600000 && new Date(s.inicioISO) >= now; });

  // información incompleta
  var incompletas = d.filter(function (s) {
    var falta = [s.nombre, s.correo, s.telefono, s.programa].filter(function (v) { return !v || v === 'No registrado'; }).length;
    return falta > 0;
  });

  function listCard(icon, titulo, items, render) {
    return '<div class="alert-card"><div class="ac-head">' + icon + ' ' + titulo + ' <span class="pill" style="margin-left:auto">' + items.length + '</span></div>' +
      (items.length ? '<ul>' + items.slice(0, 6).map(render).join('') + '</ul>' : '<div class="none">Sin alertas.</div>') + '</div>';
  }
  var host = $('#alertCards');
  host.innerHTML =
    listCard('⚠️', 'Próximas 24 horas', p24, function (s) { return '<li><span class="when">' + esc(s.horaInicio) + '</span>' + esc(ndef(s.nombre)) + ' · ' + chipTipo(s.tipo) + '</li>'; }) +
    listCard('⚠️', 'Próximos 3 días', p3, function (s) { return '<li><span class="when">' + fFecha(s.inicioISO) + '</span>' + esc(ndef(s.nombre)) + '</li>'; }) +
    listCard('⚠️', 'Próximos 7 días', p7, function (s) { return '<li><span class="when">' + fFecha(s.inicioISO) + '</span>' + esc(ndef(s.nombre)) + '</li>'; }) +
    listCard('🔵', 'Pendientes de verificación', pend, function (s) { return '<li><span class="when">' + fFecha(s.inicioISO) + '</span>' + esc(ndef(s.nombre)) + '</li>'; }) +
    listCard('🔴', 'Alta concentración de solicitudes', concentra, function (c) { return '<li><span class="when">' + fFecha(c.fecha.toISOString()) + '</span>' + c.n + ' solicitudes ese día</li>'; }) +
    listCard('⚠️', 'Solicitudes con poca anticipación', pocaAntic, function (s) { return '<li><span class="when">' + fFecha(s.inicioISO) + '</span>' + esc(ndef(s.nombre)) + '</li>'; }) +
    listCard('⚠️', 'Información incompleta', incompletas, function (s) { return '<li><span class="when">' + fFecha(s.inicioISO) + '</span>' + esc(ndef(s.nombre)) + ' · ' + chipTipo(s.tipo) + '</li>'; });
}

/* ============================ DRAWER (detalle) ============================ */
function abrirDrawer(id) {
  var s = conEstado(DATA).filter(function (x) { return x.id === id; })[0]; if (!s) return;
  $('#drTitle').textContent = ndef(s.nombre);
  $('#drChips').innerHTML = chipTipo(s.tipo) + ' ' + chipEstado(s._estado);
  var fields = [
    ['Solicitante', ndef(s.nombre)], ['Correo electrónico', ndef(s.correo)], ['Teléfono / WhatsApp', ndef(s.telefono)],
    ['Programa', ndef(s.programa)], ['Tipo de requerimiento', s.tipo],
    ['Fecha del servicio', fFechaLarga(s.inicioISO), true], ['Hora', (s.horaInicio || '—') + ' – ' + (s.horaFin || '—'), true]
  ];
  if (s.tipo === 'Cubrimiento') fields.push(['Lugar del cubrimiento', ndef(s.lugar)]);
  if (s.tipo === 'Pieza gráfica') fields.push(['Descripción de la pieza', ndef(s.descripcionPieza)]);
  if (s.tipo === 'Grabación de video') { fields.push(['Lugar', ndef(s.lugar)]); }
  if (s.infoAdicional && s.infoAdicional !== 'No registrado') fields.push(['Información adicional', s.infoAdicional]);
  fields.push(['Fecha de solicitud', s.fechaCreacion ? fFechaLarga(s.fechaCreacion) : 'No registrado']);
  if (s.entregado && s.fechaEntrega) {
    fields.push(['Material entregado', fFechaLarga(s.fechaEntrega)]);
    var tr = tiempoRespuestaHoras(s);
    if (tr != null) fields.push(['⏱️ Tiempo de respuesta', fmtDuracion(tr) + ' (solicitud → entrega)']);
  }
  fields.push(['ID del evento', s.id, true]);
  $('#drBody').innerHTML = fields.map(function (f) {
    return '<div class="field"><div class="f-label">' + f[0] + '</div><div class="f-value' + (f[2] ? ' mono' : '') + '">' + esc(f[1]) + '</div></div>';
  }).join('');

  // Seguimiento: delegado + material entregado
  var seg = el('div');
  seg.style.cssText = 'margin-top:6px;padding-top:14px;border-top:1px solid var(--line)';
  seg.innerHTML =
    '<div class="f-label" style="margin-bottom:6px">Delegar actividad a</div>' +
    '<select class="deleg-select' + (s.delegado ? ' set' : '') + '" id="drDeleg" style="width:100%;margin-bottom:12px;padding:8px">' + opcionesDelegado(s.delegado) + '</select>' +
    '<label class="entrega-check' + (s.entregado ? ' on' : '') + '" id="drEntregaLbl" style="width:100%;justify-content:center"><input type="checkbox" id="drEntrega"' + (s.entregado ? ' checked' : '') + '> 📦 Material entregado</label>';
  $('#drBody').appendChild(seg);
  $('#drDeleg').addEventListener('change', function () {
    cambiarSeguimiento(s.id, { delegado: this.value }, '👤 Actividad delegada.', true);
  });
  $('#drEntrega').addEventListener('change', function () {
    var chk = this.checked;
    cambiarSeguimiento(s.id, { entregado: chk }, chk ? '📦 Material entregado registrado.' : 'Entrega desmarcada.', true);
  });

  var picker = $('#drStatusPicker'); picker.innerHTML = '';
  [['REALIZADA','qbtn ok'],['NO_REALIZADA','qbtn no'],['CANCELADA','qbtn cancel'],['PROGRAMADA','qbtn']].forEach(function (o) {
    var b = el('button', o[1], ESTADOS[o[0]].emoji + ' ' + ESTADOS[o[0]].label);
    b.style.justifyContent = 'center';
    b.addEventListener('click', function () { cambiarSeguimiento(s.id, { estado: o[0] }, 'Estado actualizado a ' + ESTADOS[o[0]].label.toLowerCase() + '.', true); });
    picker.appendChild(b);
  });
  var cal = $('#drCalLink'); if (s.enlaceEvento) { cal.href = s.enlaceEvento; cal.style.display = ''; } else { cal.style.display = 'none'; }

  $('#overlay').classList.add('show'); $('#drawer').classList.add('show');
}
function cerrarDrawer() { $('#overlay').classList.remove('show'); $('#drawer').classList.remove('show'); }

/* ============================ INFORMES ============================ */
function rangoPeriodo(periodo) {
  var now = new Date(); var ini, fin = new Date(now);
  if (periodo === 'semana') { ini = startOfWeek(now); fin = new Date(ini); fin.setDate(fin.getDate() + 7); }
  else if (periodo === 'mes') { ini = new Date(now.getFullYear(), now.getMonth(), 1); fin = new Date(now.getFullYear(), now.getMonth() + 1, 1); }
  else if (periodo === 'trimestre') { var q = Math.floor(now.getMonth() / 3); ini = new Date(now.getFullYear(), q * 3, 1); fin = new Date(now.getFullYear(), q * 3 + 3, 1); }
  else { ini = new Date(now.getFullYear(), 0, 1); fin = new Date(now.getFullYear() + 1, 0, 1); }
  return { ini: ini, fin: fin };
}
function datosInforme(periodo) {
  var r = rangoPeriodo(periodo);
  var d = conEstado(DATA).filter(function (s) { var f = new Date(s.inicioISO); return f >= r.ini && f < r.fin; });
  var c = function (fn) { return d.filter(fn).length; };
  var porPrograma = {}; d.forEach(function (s) { var p = ndef(s.programa); porPrograma[p] = (porPrograma[p] || 0) + 1; });
  var pasadas = d.filter(function (s) { return esPasada(s) && s._estado !== 'CANCELADA'; });
  var pct = pasadas.length ? Math.round(pasadas.filter(function (s) { return s._estado === 'REALIZADA'; }).length / pasadas.length * 100) : 0;
  return {
    rango: r, total: d.length, lista: d,
    porPrograma: porPrograma,
    cub: c(function (s) { return s.tipo === 'Cubrimiento'; }), pza: c(function (s) { return s.tipo === 'Pieza gráfica'; }), vid: c(function (s) { return s.tipo === 'Grabación de video'; }),
    real: c(function (s) { return s._estado === 'REALIZADA'; }), nore: c(function (s) { return s._estado === 'NO_REALIZADA'; }), pend: c(function (s) { return s._estado === 'PENDIENTE'; }), prog: c(function (s) { return s._estado === 'PROGRAMADA'; }), canc: c(function (s) { return s._estado === 'CANCELADA'; }),
    cumplimiento: pct
  };
}
function renderInforme() {
  var periodo = $('#repPeriodo').value; var r = datosInforme(periodo);
  var titulo = { semana: 'Informe semanal', mes: 'Informe mensual', trimestre: 'Informe trimestral', anio: 'Informe anual' }[periodo];
  var progRows = Object.keys(r.porPrograma).sort(function (a, b) { return r.porPrograma[b] - r.porPrograma[a]; })
    .map(function (p) { return '<tr><td>' + esc(p) + '</td><td class="num">' + r.porPrograma[p] + '</td><td class="num">' + Math.round(r.porPrograma[p] / (r.total || 1) * 100) + '%</td></tr>'; }).join('');
  $('#reportBody').innerHTML =
    '<div class="card"><div class="card-head"><h3>' + titulo + '</h3><span class="hint">' + fFecha(r.rango.ini.toISOString()) + ' – ' + fFecha(new Date(r.rango.fin.getTime() - 86400000).toISOString()) + '</span></div>' +
    '<div class="card-body">' +
      '<div class="kpi-grid" style="margin-bottom:18px">' +
        '<div class="kpi"><div class="k-label">Total</div><div class="k-value">' + r.total + '</div></div>' +
        '<div class="kpi st-real"><div class="k-label">🟢 Realizadas</div><div class="k-value">' + r.real + '</div></div>' +
        '<div class="kpi st-nore"><div class="k-label">🔴 No realizadas</div><div class="k-value">' + r.nore + '</div></div>' +
        '<div class="kpi st-pend"><div class="k-label">🔵 Pendientes</div><div class="k-value">' + r.pend + '</div></div>' +
        '<div class="kpi st-prog"><div class="k-label">🟡 Programadas</div><div class="k-value">' + r.prog + '</div></div>' +
        '<div class="kpi"><div class="k-label">% Cumplimiento</div><div class="k-value">' + r.cumplimiento + '%</div></div>' +
      '</div>' +
      '<div class="grid-2">' +
        '<div><h4 style="margin-bottom:10px">Distribución por tipo</h4><table class="data" style="min-width:0"><tbody>' +
          '<tr><td>📸 Cubrimientos</td><td class="num">' + r.cub + '</td></tr><tr><td>🎨 Piezas gráficas</td><td class="num">' + r.pza + '</td></tr><tr><td>🎥 Grabaciones de video</td><td class="num">' + r.vid + '</td></tr>' +
        '</tbody></table></div>' +
        '<div><h4 style="margin-bottom:10px">Distribución por programa</h4><table class="data" style="min-width:0"><thead><tr><th class="no-sort">Programa</th><th class="no-sort">N.º</th><th class="no-sort">%</th></tr></thead><tbody>' + (progRows || '<tr><td colspan="3" style="color:var(--faint)">Sin datos</td></tr>') + '</tbody></table></div>' +
      '</div>' +
    '</div></div>';
}

/* ============================ EXPORTACIÓN ============================ */
function tablaExportable(list) {
  return list.map(function (s) {
    var tr = tiempoRespuestaHoras(s);
    return {
      Fecha: fFecha(s.inicioISO), Hora: s.horaInicio || '', HoraFin: s.horaFin || '',
      Solicitante: ndef(s.nombre), Correo: ndef(s.correo), Telefono: ndef(s.telefono),
      Programa: ndef(s.programa), Tipo: s.tipo, Lugar: ndef(s.lugar),
      DescripcionPieza: ndef(s.descripcionPieza), Estado: (ESTADOS[s._estado] || {}).label || s._estado,
      Delegado: s.delegado || 'Sin asignar',
      MaterialEntregado: s.entregado ? 'Sí' : 'No',
      FechaSolicitud: s.fechaCreacion ? fFecha(s.fechaCreacion) : '',
      FechaEntrega: s.fechaEntrega ? fFecha(s.fechaEntrega) : '',
      TiempoRespuesta: tr != null ? fmtDuracion(tr) : '',
      InfoAdicional: ndef(s.infoAdicional), Enlace: s.enlaceEvento || ''
    };
  });
}
function exportCSV(list, nombre) {
  var rows = tablaExportable(list); if (!rows.length) { toast('Nada que exportar.', 'err'); return; }
  var headers = Object.keys(rows[0]);
  var csv = [headers.join(',')].concat(rows.map(function (r) { return headers.map(function (h) { return '"' + String(r[h]).replace(/"/g, '""') + '"'; }).join(','); })).join('\n');
  descargar(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }), nombre + '.csv');
}
function exportXLSX(list, nombre) {
  var rows = tablaExportable(list); if (!rows.length) { toast('Nada que exportar.', 'err'); return; }
  var ws = XLSX.utils.json_to_sheet(rows); var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Solicitudes'); XLSX.writeFile(wb, nombre + '.xlsx');
}
function exportInformePDF() {
  var periodo = $('#repPeriodo').value; var r = datosInforme(periodo);
  var titulo = { semana: 'Informe semanal', mes: 'Informe mensual', trimestre: 'Informe trimestral', anio: 'Informe anual' }[periodo];
  var jsPDF = window.jspdf.jsPDF; var doc = new jsPDF();
  doc.setFontSize(16); doc.text(titulo + ' — Solicitudes de Prensa', 14, 18);
  doc.setFontSize(10); doc.setTextColor(100); doc.text(CFG.ENTIDAD + ' · ' + CFG.SUBTITULO, 14, 25);
  doc.text('Periodo: ' + fFecha(r.rango.ini.toISOString()) + ' – ' + fFecha(new Date(r.rango.fin.getTime() - 86400000).toISOString()), 14, 31);
  doc.autoTable({ startY: 38, head: [['Indicador', 'Valor']], body: [
    ['Total de solicitudes', r.total], ['Cubrimientos', r.cub], ['Piezas gráficas', r.pza], ['Grabaciones de video', r.vid],
    ['Realizadas', r.real], ['No realizadas', r.nore], ['Pendientes de verificación', r.pend], ['Programadas', r.prog], ['Canceladas', r.canc],
    ['Porcentaje de cumplimiento', r.cumplimiento + '%']
  ], theme: 'striped', headStyles: { fillColor: [15, 110, 123] } });
  var progBody = Object.keys(r.porPrograma).sort(function (a, b) { return r.porPrograma[b] - r.porPrograma[a]; }).map(function (p) { return [p, r.porPrograma[p]]; });
  if (progBody.length) doc.autoTable({ startY: doc.lastAutoTable.finalY + 8, head: [['Programa', 'Solicitudes']], body: progBody, theme: 'grid', headStyles: { fillColor: [201, 155, 63] } });
  doc.save('informe_' + periodo + '.pdf');
}
function descargar(blob, nombre) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000); }

/* ============================ SELECTORES / FILTROS UI ============================ */
function poblarSelect(sel, valores, incluirVacio) {
  var cur = sel.value;
  sel.innerHTML = (incluirVacio ? '<option value="">' + incluirVacio + '</option>' : '');
  valores.forEach(function (v) { var o = el('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
  if (valores.indexOf(cur) !== -1) sel.value = cur;
}
function refrescarSelectores() {
  var d = DATA;
  var programas = Array.from(new Set(d.map(function (s) { return ndef(s.programa); }))).filter(function (v) { return v !== 'No registrado'; }).sort();
  var lugares = Array.from(new Set(d.map(function (s) { return ndef(s.lugar); }))).filter(function (v) { return v !== 'No registrado'; }).sort();
  // Filtro de estado: value = clave interna, texto = etiqueta
  var estActual = $('#fltEstado').value;
  $('#fltEstado').innerHTML = '<option value="">Todos los estados</option>' + Object.keys(ESTADOS).map(function (k) { return '<option value="' + k + '">' + ESTADOS[k].label + '</option>'; }).join('');
  if (estActual) $('#fltEstado').value = estActual;
  poblarSelect($('#fltTipo'), Object.keys(TIPOS), 'Todos los tipos');
  poblarSelect($('#fltPrograma'), programas, 'Todos los programas');
  poblarSelect($('#fltLugar'), lugares, 'Todos los lugares');
  poblarSelect($('#anProg'), programas, '— Todos los programas —');
}

/* ============================ REFRESCO GLOBAL ============================ */
function vistaActual() { var v = document.querySelector('.view.active'); return v ? v.id.replace('view-', '') : 'dashboard'; }
function renderVistaActual() {
  var v = vistaActual();
  if (v === 'dashboard') renderDashboard();
  else if (v === 'agenda') renderAgenda();
  else if (v === 'solicitudes') renderTabla();
  else if (v === 'cubrimientos') renderCubrimientos();
  else if (v === 'piezas') renderPiezas();
  else if (v === 'videos') renderVideos();
  else if (v === 'pendientes') renderPendientesFull();
  else if (v === 'analisis') renderAnalisis();
  else if (v === 'informes') renderInforme();
}
/* Refresco rápido tras guardar: solo actualiza el badge y la vista visible (no re-dibuja todo). */
function refrescarLigero() {
  var pend = conEstado(DATA).filter(function (s) { return s._estado === 'PENDIENTE'; }).length;
  $('#navPendBadge').textContent = pend;
  renderVistaActual();
}
function refrescarVistas() {
  var k = calcularKpis();
  $('#navPendBadge').textContent = k.pendiente;
  renderDashboard(); renderTabla(); renderPendientesFull();
  renderCubrimientos(); renderPiezas(); renderVideos();
  renderAgenda(); renderAnalisis(); renderInforme();
}

/* ============================ SINCRONIZACIÓN ============================ */
function sincronizar(manual) {
  var btn = $('#syncBtn'); var ico = $('#syncIco');
  ico.className = 'spin'; btn.disabled = true;
  return cargarSolicitudes().then(function (list) {
    // Deduplicar por ID (por seguridad)
    var seen = {}; DATA = list.filter(function (s) { if (seen[s.id]) return false; seen[s.id] = 1; return true; });
    refrescarSelectores(); refrescarVistas();
    if (manual) toast('✅ ' + DATA.length + ' solicitudes sincronizadas.', 'ok');
  }).catch(function (err) {
    toast('⚠️ ' + err.message, 'err');
  }).then(function () { ico.className = ''; ico.textContent = '🔄'; btn.disabled = false; });
}

/* ============================ TOAST ============================ */
var toastTimer;
function toast(msg, tipo) {
  var t = $('#toast'); t.textContent = msg; t.className = 'toast show ' + (tipo || '');
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = 'toast'; }, 3200);
}

/* ============================ NAVEGACIÓN ============================ */
var TITULOS = {
  dashboard: ['Dashboard', 'Panel general de solicitudes'], agenda: ['Agenda', 'Calendario de prensa'],
  solicitudes: ['Solicitudes', 'Tabla general de solicitudes'], cubrimientos: ['Cubrimientos', 'Servicios de cubrimiento'],
  piezas: ['Piezas gráficas', 'Solicitudes de diseño'], videos: ['Videos', 'Grabaciones de video'],
  pendientes: ['Pendientes de verificación', 'Solicitudes por confirmar'], analisis: ['Análisis', 'Indicadores y analítica'],
  informes: ['Informes', 'Generación de informes'], config: ['Configuración', 'Parámetros del sistema']
};
function irA(vista) {
  $$('#nav a').forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-view') === vista); });
  $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + vista); });
  $('#pageTitle').textContent = TITULOS[vista][0]; $('#pageSub').textContent = TITULOS[vista][1];
  cerrarSidebarMovil();
  // recalcular gráficos al entrar (Chart.js necesita el contenedor visible)
  if (vista === 'analisis') renderAnalisis();
  if (vista === 'cubrimientos') renderCubrimientos();
  if (vista === 'dashboard') renderDashboard();
  if (vista === 'agenda') renderAgenda();
  window.scrollTo(0, 0);
}
function cerrarSidebarMovil() { $('#sidebar').classList.remove('open'); $('#backdrop').classList.remove('show'); }

/* ============================ CONFIGURACIÓN UI ============================ */
function cargarConfigUI() {
  $('#cfgModo').value = CFG.MODO; $('#cfgUrl').value = CFG.API_URL || ''; $('#cfgToken').value = CFG.API_TOKEN || '';
  $('#cfgSync').value = String(CFG.AUTO_SYNC_MS || 0);
  $('#cfgPCub').value = CFG.PONDERACIONES['Cubrimiento']; $('#cfgPPza').value = CFG.PONDERACIONES['Pieza gráfica']; $('#cfgPVid').value = CFG.PONDERACIONES['Grabación de video'];
  $('#cfgUMed').value = CFG.CARGA_UMBRALES.media; $('#cfgUAlta').value = CFG.CARGA_UMBRALES.alta;
}
function guardarConfigUI() {
  CFG.MODO = $('#cfgModo').value; CFG.API_URL = $('#cfgUrl').value.trim(); CFG.API_TOKEN = $('#cfgToken').value.trim();
  CFG.AUTO_SYNC_MS = parseInt($('#cfgSync').value, 10) || 0;
  CFG.PONDERACIONES = { 'Cubrimiento': +$('#cfgPCub').value || 0, 'Pieza gráfica': +$('#cfgPPza').value || 0, 'Grabación de video': +$('#cfgPVid').value || 0 };
  CFG.CARGA_UMBRALES = { media: +$('#cfgUMed').value || 0, alta: +$('#cfgUAlta').value || 0 };
  saveConfig(); actualizarModeTag(); configurarAutoSync();
  toast('⚙️ Configuración guardada.', 'ok');
  sincronizar(false);
}
function actualizarModeTag() {
  var tag = $('#modeTag'); var esDemo = CFG.MODO === 'demo';
  tag.className = 'mode-tag ' + (esDemo ? 'demo' : 'prod');
  $('#modeText').textContent = esDemo ? 'Modo demo' : 'Modo producción';
  $('#brandSub').textContent = CFG.ENTIDAD;
}
function configurarAutoSync() {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
  if (CFG.AUTO_SYNC_MS && CFG.MODO === 'produccion') syncTimer = setInterval(function () { sincronizar(false); }, CFG.AUTO_SYNC_MS);
}

/* ============================ RELOJ ============================ */
function tick() { var n = new Date(); $('#clock').textContent = DOW_FULL[n.getDay()].slice(0,3) + ' ' + n.getDate() + '/' + (n.getMonth()+1) + ' · ' + String(n.getHours()).padStart(2,'0') + ':' + String(n.getMinutes()).padStart(2,'0'); }

/* ============================ EVENTOS ============================ */
function bindEventos() {
  $$('#nav a').forEach(function (a) { a.addEventListener('click', function () { irA(a.getAttribute('data-view')); }); });
  $('#hamburger').addEventListener('click', function () { $('#sidebar').classList.toggle('open'); $('#backdrop').classList.toggle('show'); });
  $('#backdrop').addEventListener('click', cerrarSidebarMovil);
  $('#syncBtn').addEventListener('click', function () { sincronizar(true); });

  // Filtro por fechas del dashboard (inicio)
  function setDashRango(desde, hasta) { dashDesde = desde; dashHasta = hasta; $('#dashDesde').value = desde; $('#dashHasta').value = hasta; renderDashboard(); }
  $('#dashDesde').addEventListener('change', function () { dashDesde = this.value; renderDashboard(); });
  $('#dashHasta').addEventListener('change', function () { dashHasta = this.value; renderDashboard(); });
  $('#dashRango7').addEventListener('click', function () { var h = new Date(); var a = new Date(); a.setDate(a.getDate() - 6); setDashRango(fmtISOdate(a), fmtISOdate(h)); });
  $('#dashRango30').addEventListener('click', function () { var h = new Date(); var a = new Date(); a.setDate(a.getDate() - 29); setDashRango(fmtISOdate(a), fmtISOdate(h)); });
  $('#dashRangoMes').addEventListener('click', function () { var n = new Date(); setDashRango(fmtISOdate(new Date(n.getFullYear(), n.getMonth(), 1)), fmtISOdate(new Date(n.getFullYear(), n.getMonth() + 1, 0))); });
  $('#dashRangoClear').addEventListener('click', function () { setDashRango('', ''); });
  $('#overlay').addEventListener('click', cerrarDrawer); $('#drClose').addEventListener('click', cerrarDrawer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrarDrawer(); });

  // Agenda
  $$('#agendaViews button').forEach(function (b) { b.addEventListener('click', function () { $$('#agendaViews button').forEach(function (x) { x.classList.remove('active'); }); b.classList.add('active'); agendaVista = b.getAttribute('data-av'); renderAgenda(); }); });
  $('#agPrev').addEventListener('click', function () { moverAgenda(-1); }); $('#agNext').addEventListener('click', function () { moverAgenda(1); });
  $('#agToday').addEventListener('click', function () { agendaCursor = new Date(); renderAgenda(); });

  // Tabla
  ['#tblSearch','#fltEstado','#fltTipo','#fltPrograma','#fltLugar','#fltDesde','#fltHasta'].forEach(function (s) { $(s).addEventListener('input', renderTabla); $(s).addEventListener('change', renderTabla); });
  $('#fltClear').addEventListener('click', function () { ['#tblSearch','#fltEstado','#fltTipo','#fltPrograma','#fltLugar','#fltDesde','#fltHasta'].forEach(function (s) { $(s).value = ''; }); renderTabla(); });
  $$('#mainTable th[data-sort]').forEach(function (th) { th.addEventListener('click', function () { var k = th.getAttribute('data-sort'); if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = 1; } renderTabla(); }); });
  $('#expCsv').addEventListener('click', function () { exportCSV(window._tablaFiltrada || conEstado(DATA), 'solicitudes'); });
  $('#expXlsx').addEventListener('click', function () { exportXLSX(window._tablaFiltrada || conEstado(DATA), 'solicitudes'); });

  // Análisis por programa
  $('#anProg').addEventListener('change', renderAnalisisPrograma);

  // Informes
  $('#repPeriodo').addEventListener('change', renderInforme);
  $('#repCsv').addEventListener('click', function () { exportCSV(datosInforme($('#repPeriodo').value).lista, 'informe_' + $('#repPeriodo').value); });
  $('#repXlsx').addEventListener('click', function () { exportXLSX(datosInforme($('#repPeriodo').value).lista, 'informe_' + $('#repPeriodo').value); });
  $('#repPdf').addEventListener('click', exportInformePDF);

  // Config
  $('#cfgSave').addEventListener('click', guardarConfigUI);
  $('#cfgReset').addEventListener('click', function () { localStorage.removeItem(LS_KEY); loadConfig(); cargarConfigUI(); actualizarModeTag(); toast('Configuración restablecida.', 'ok'); sincronizar(false); });
}
function moverAgenda(dir) {
  if (agendaVista === 'mes') agendaCursor.setMonth(agendaCursor.getMonth() + dir);
  else if (agendaVista === 'semana') agendaCursor.setDate(agendaCursor.getDate() + dir * 7);
  else if (agendaVista === 'dia') agendaCursor.setDate(agendaCursor.getDate() + dir);
  agendaCursor = new Date(agendaCursor); renderAgenda();
}

/* ============================ INICIO ============================ */
function init() {
  loadConfig();
  actualizarModeTag(); cargarConfigUI(); refrescarSelectores();
  bindEventos(); tick(); setInterval(tick, 30000);
  configurarAutoSync();
  sincronizar(false);
}
document.addEventListener('DOMContentLoaded', init);

})();
