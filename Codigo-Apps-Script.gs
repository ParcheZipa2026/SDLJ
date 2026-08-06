/*************************************************************************
 * CENTRO DE OPERACIONES · SEMANA DE LA JUVENTUD — BACKEND (Apps Script) v2
 * -----------------------------------------------------------------------
 * API JSON/JSONP sobre Google Sheets + Google Drive + Google Calendar.
 *
 * CAMBIOS v2 (resuelven la conexión y agregan funciones):
 *   - JSONP (parámetro callback): evita los bloqueos CORS que impedían
 *     que la página leyera en vivo. TODAS las acciones funcionan por GET.
 *   - Sincronización con Google Calendar (crea/actualiza/borra eventos).
 *   - Carpetas de Drive por evento + acción para abrirlas.
 *   - Acción "delete" para eliminar registros.
 *   - IDs automáticos: a las filas que agregues a mano sin ID_ACT / ID_EVENTO
 *     / ID_LOG se les asigna uno solo, para que se puedan editar.
 *
 * DESPUÉS DE PEGAR ESTE CÓDIGO (IMPORTANTE):
 *   1. Ejecuta la función  autorizar()  una vez y acepta TODOS los permisos
 *      (Hojas, Drive y Calendario). Sin esto, el calendario y Drive fallan.
 *   2. Implementar → Administrar implementaciones → (lápiz) Editar →
 *      Versión: "Nueva versión" → Implementar.  ← indispensable para que
 *      la URL /exec ejecute este código nuevo.
 *   3. Verifica que "Quién tiene acceso" = Cualquiera.
 *************************************************************************/

// ====== CONFIGURACIÓN ======
var ROOT_FOLDER_NAME = 'Semana de la Juventud 2026';
var CALENDAR_ID = 'c_2a9651ed355c97d7ddbbc29ea27841969c4078b35fc9801945a60daca649094d@group.calendar.google.com';
var SHEETS = ['EVENTOS','PLANEACION','CRONOGRAMA','PRESUPUESTO','LOGISTICA',
              'EVIDENCIAS','RESPONSABLES','CONFIGURACION','HISTORIAL','COMENTARIOS'];
var EVENT_SUBFOLDERS = ['01 Planeación','02 Oficios','03 Evidencias','04 Fotografías',
                        '05 Videos','06 Logística','07 Informes','08 Prensa','09 Actas'];

// ====== HOJA DE CÁLCULO (script independiente o unido a una hoja) ======
function getSS_(){
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if(active) return active;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SS_ID');
  if(id){ try{ return SpreadsheetApp.openById(id); }catch(e){} }
  var ss = SpreadsheetApp.create('Semana de la Juventud — Base de datos');
  props.setProperty('SS_ID', ss.getId());
  Logger.log('Hoja de cálculo creada: ' + ss.getUrl());
  return ss;
}

// ====== ROUTER (soporta JSONP con ?callback=) ======
function doGet(e){
  var params = {};
  if(e && e.parameter) for(var k in e.parameter) params[k] = e.parameter[k];
  if(params.row){ try{ params.row = JSON.parse(params.row); }catch(_){} }
  var result;
  try{ result = handle_(params); }catch(err){ result = {ok:false, error:String(err)}; }
  return reply_(result, params.callback);
}
function doPost(e){
  var params = {};
  if(e && e.parameter) for(var k in e.parameter) params[k] = e.parameter[k];
  try{ var body = JSON.parse(e.postData.contents); for(var k2 in body) params[k2] = body[k2]; }catch(_){}
  var result;
  try{ result = handle_(params); }catch(err){ result = {ok:false, error:String(err)}; }
  return reply_(result, params.callback);
}
function reply_(obj, callback){
  var js = JSON.stringify(obj);
  if(callback){
    return ContentService.createTextOutput(callback + '(' + js + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(js).setMimeType(ContentService.MimeType.JSON);
}

// Dispatcher central — cada acción funciona por GET (JSONP) o POST
function handle_(p){
  switch(p.action){
    case 'ping':           return {ok:true, msg:'Centro de Operaciones activo', time:new Date().toISOString()};
    case 'bootstrap':      return bootstrap_();
    case 'update':         return updateField_(p);
    case 'create':         return createRow_(p);
    case 'comment':        return appendRow_('COMENTARIOS', p.row);
    case 'delete':         return deleteRow_(p);
    case 'logcheck':       return logCheck_(p);
    case 'uploadEvidence': return uploadEvidence_(p);
    case 'folder':         return ensureEventFolder_(p.idEvento, p.nombre || '');
    case 'renameEventFolder': return renameEventFolder_(p.idEvento, p.nombre);
    case 'syncCalendar':   return syncCalendar_();
    case 'testCalendar':   return testCalendar_();
    default: return {ok:false, error:'acción desconocida: ' + p.action};
  }
}

// ====== LECTURA ======
function bootstrap_(){
  var ss = getSS_();
  // Asigna IDs a filas agregadas a mano sin llave (para que sean editables)
  ensureIds_(ss,'PLANEACION','ID_ACT','A');
  ensureIds_(ss,'EVENTOS','ID_EVENTO','EV');
  ensureIds_(ss,'LOGISTICA','ID_LOG','L');
  var out = {ok:true};
  SHEETS.forEach(function(name){
    var sh = ss.getSheetByName(name);
    out[name] = sh ? sheetToObjects_(sh) : [];
  });
  return out;
}

function sheetToObjects_(sh){
  var values = sh.getDataRange().getValues();
  if(values.length < 2) return [];
  var headers = values[0].map(function(h){ return String(h).trim(); });
  var rows = [];
  for(var r=1; r<values.length; r++){
    var obj = {}, empty = true;
    for(var c=0; c<headers.length; c++){
      if(!headers[c]) continue;
      var v = values[r][c];
      if(v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      obj[headers[c]] = v;
      if(v !== '' && v !== null) empty = false;
    }
    if(!empty) rows.push(obj);
  }
  return rows;
}

// Asigna un ID correlativo a las filas que no lo tengan (crea la columna si falta)
function ensureIds_(ss, name, idField, prefix){
  var sh = ss.getSheetByName(name); if(!sh) return;
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if(lastRow < 2) return;
  var data = sh.getRange(1,1,lastRow,lastCol).getValues();
  var headers = data[0];
  var ci = headers.indexOf(idField);
  if(ci < 0){ ci = headers.length; sh.getRange(1, ci+1).setValue(idField); }
  var maxN = 0;
  for(var r=1; r<data.length; r++){
    var v = (ci < data[r].length) ? data[r][ci] : '';
    var m = String(v).match(/(\d+)/);
    if(v && m) maxN = Math.max(maxN, parseInt(m[1],10));
  }
  for(var r2=1; r2<data.length; r2++){
    var rowEmpty = data[r2].every(function(x){ return x==='' || x===null; });
    if(rowEmpty) continue;
    var val = (ci < data[r2].length) ? data[r2][ci] : '';
    if(!val){ maxN++; sh.getRange(r2+1, ci+1).setValue(prefix + ('000'+maxN).slice(-3)); }
  }
}

// Devuelve una fila como objeto (con fechas ya formateadas a texto)
function getRowObj_(sheetName, idField, idValue){
  var rows = sheetToObjects_(getSS_().getSheetByName(sheetName));
  for(var i=0;i<rows.length;i++){ if(String(rows[i][idField]) === String(idValue)) return rows[i]; }
  return null;
}

// ====== ESCRITURA ======
function updateField_(p){
  var sh = getSS_().getSheetByName(p.sheet);
  if(!sh) throw 'Hoja no existe: ' + p.sheet;
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var idCol = headers.indexOf(p.idField);
  var fieldCol = headers.indexOf(p.field);
  if(idCol < 0) throw 'Columna llave no existe: ' + p.idField;
  if(fieldCol < 0){ fieldCol = headers.length; sh.getRange(1, fieldCol+1).setValue(p.field); }
  for(var r=1; r<data.length; r++){
    if(String(data[r][idCol]) === String(p.idValue)){
      var prev = data[r][fieldCol];
      sh.getRange(r+1, fieldCol+1).setValue(p.value);
      logHistory_(p.field + ' (' + p.idValue + ')', prev, p.value);
      if(p.sheet === 'EVENTOS' && p.field === 'Nombre') renameEventFolder_(p.idValue, p.value);
      if(p.sheet === 'PLANEACION') syncOneActivity_(p.idValue); // refleja el cambio en Calendar
      return {ok:true};
    }
  }
  throw 'Registro no encontrado: ' + p.idValue;
}

function createRow_(p){
  appendRow_(p.sheet, p.row);
  if(p.sheet === 'EVENTOS' && p.row.ID_EVENTO){
    var f = ensureEventFolder_(p.row.ID_EVENTO, p.row.Nombre);
    writeCell_('EVENTOS','ID_EVENTO', p.row.ID_EVENTO, 'DriveURL', f.url);
  }
  if(p.sheet === 'PLANEACION' && p.row.ID_ACT) syncOneActivity_(p.row.ID_ACT);
  return {ok:true};
}

function appendRow_(sheetName, row){
  var ss = getSS_();
  var sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  var headers = sh.getLastRow() ? sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0] : [];
  if(!headers.length){ headers = Object.keys(row); sh.appendRow(headers); }
  Object.keys(row).forEach(function(k){ if(headers.indexOf(k) < 0){ headers.push(k); sh.getRange(1, headers.length).setValue(k); } });
  var line = headers.map(function(h){ return row[h] != null ? row[h] : ''; });
  sh.appendRow(line);
  return {ok:true};
}

// Escribe una celda sin registrar historial ni recursión (uso interno)
function writeCell_(sheetName, idField, idValue, field, value){
  var sh = getSS_().getSheetByName(sheetName); if(!sh) return;
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var ic = headers.indexOf(idField), fc = headers.indexOf(field);
  if(ic < 0) return;
  if(fc < 0){ fc = headers.length; sh.getRange(1, fc+1).setValue(field); }
  for(var r=1; r<data.length; r++){
    if(String(data[r][ic]) === String(idValue)){ sh.getRange(r+1, fc+1).setValue(value); return; }
  }
}

function deleteRow_(p){
  var sh = getSS_().getSheetByName(p.sheet);
  if(!sh) throw 'Hoja no existe: ' + p.sheet;
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var idCol = headers.indexOf(p.idField);
  if(idCol < 0) throw 'Columna llave no existe: ' + p.idField;
  for(var r=1; r<data.length; r++){
    if(String(data[r][idCol]) === String(p.idValue)){
      // Borra el evento de Calendar vinculado, si existe
      if(p.sheet === 'PLANEACION'){
        var calI = headers.indexOf('ID_CAL');
        if(calI >= 0 && data[r][calI]){
          try{ var ev = getCal_().getEventById(data[r][calI]); if(ev) ev.deleteEvent(); }catch(e){}
        }
      }
      sh.deleteRow(r+1);
      logHistory_('Eliminado ' + p.idValue + ' en ' + p.sheet, '', 'eliminado');
      return {ok:true};
    }
  }
  throw 'Registro no encontrado: ' + p.idValue;
}

function logCheck_(p){
  return updateField_({sheet:'LOGISTICA', idField:p.idField, idValue:p.idValue,
                       field:'Check_' + p.field, value: p.value ? 'SI' : ''});
}

// ====== HISTORIAL ======
function logHistory_(campo, anterior, nuevo){
  var ss = getSS_();
  var sh = ss.getSheetByName('HISTORIAL') || ss.insertSheet('HISTORIAL');
  if(!sh.getLastRow()) sh.appendRow(['Usuario','Fecha','Hora','Campo','Anterior','Nuevo']);
  var now = new Date();
  var email = '';
  try{ email = Session.getActiveUser().getEmail(); }catch(e){}
  sh.appendRow([email || 'sistema',
    Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    Utilities.formatDate(now, Session.getScriptTimeZone(), 'HH:mm'),
    campo, anterior, nuevo]);
}

// ====== GOOGLE CALENDAR ======
function getCal_(){
  var cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if(!cal) throw 'No tengo acceso al calendario. Verifica el ID y que la cuenta del script tenga acceso a ese calendario.';
  return cal;
}
function parseDate_(s){
  if(!s) return null;
  if(s instanceof Date) return s;
  var m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  if(!m) return null;
  return new Date(+m[1], +m[2]-1, +m[3]);
}
var _evNameCache = null;
function eventName_(id){
  if(!_evNameCache){ _evNameCache = {}; sheetToObjects_(getSS_().getSheetByName('EVENTOS')).forEach(function(e){ _evNameCache[e.ID_EVENTO] = e.Nombre; }); }
  return _evNameCache[id] || id || '';
}
// Crea o actualiza el evento de Calendar de una actividad. Devuelve su ID.
function upsertActivityEvent_(a){
  var fi = a['Fecha inicio'] || a['Fecha fin'];
  var ff = a['Fecha fin'] || a['Fecha inicio'];
  var start = parseDate_(fi);
  if(!start) return a.ID_CAL || '';
  var end = parseDate_(ff) || start;
  if(end < start) end = start;
  var endEx = new Date(end.getTime() + 86400000); // fin exclusivo para evento de día completo
  var title = (a.Evento ? '[' + eventName_(a.Evento) + '] ' : '') + (a.Actividad || 'Actividad');
  var desc = 'Estado: ' + (a.Estado || '—') + '\nResponsable: ' + (a.Responsable || '—') + '\nID: ' + (a.ID_ACT || '');
  var cal = getCal_();
  var ev = null;
  if(a.ID_CAL){ try{ ev = cal.getEventById(a.ID_CAL); }catch(e){} }
  if(ev){ ev.setTitle(title); ev.setDescription(desc); ev.setAllDayDates(start, endEx); return a.ID_CAL; }
  ev = cal.createAllDayEvent(title, start, endEx, {description: desc});
  return ev.getId();
}
function syncOneActivity_(idAct){
  try{
    var a = getRowObj_('PLANEACION','ID_ACT', idAct); if(!a) return;
    if(!(a['Fecha inicio'] || a['Fecha fin'])) return;
    var calId = upsertActivityEvent_(a);
    if(calId && calId !== a.ID_CAL) writeCell_('PLANEACION','ID_ACT', idAct, 'ID_CAL', calId);
  }catch(e){ /* nunca romper la edición por un fallo de calendario */ }
}
// Sincroniza TODA la planeación con el calendario (botón en la app)
function syncCalendar_(){
  var rows = sheetToObjects_(getSS_().getSheetByName('PLANEACION'));
  var n = 0, errores = 0, detalle = '';
  rows.forEach(function(a){
    if(!(a['Fecha inicio'] || a['Fecha fin'])) return;
    try{
      var id = upsertActivityEvent_(a);
      if(id && id !== a.ID_CAL) writeCell_('PLANEACION','ID_ACT', a.ID_ACT, 'ID_CAL', id);
      n++;
    }catch(e){ errores++; detalle = String(e); }
  });
  return {ok:true, sincronizadas:n, errores:errores, detalle:detalle};
}
function testCalendar_(){
  try{ var cal = getCal_(); return {ok:true, calendario: cal.getName()}; }
  catch(e){ return {ok:false, error:String(e)}; }
}

// ====== GOOGLE DRIVE ======
function getRootFolder_(){
  var it = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);
}
function ensureEventFolder_(idEvento, nombre){
  var root = getRootFolder_();
  var folder = findEventFolder_(root, idEvento);
  var target = idEvento + ' - ' + (nombre || eventName_(idEvento));
  if(!folder){ folder = root.createFolder(target); }
  else if(folder.getName() !== target){ folder.setName(target); }
  EVENT_SUBFOLDERS.forEach(function(sub){ if(!folder.getFoldersByName(sub).hasNext()) folder.createFolder(sub); });
  writeCell_('EVENTOS','ID_EVENTO', idEvento, 'DriveURL', folder.getUrl());
  return {ok:true, folderId: folder.getId(), url: folder.getUrl()};
}
function renameEventFolder_(idEvento, nombre){
  var root = getRootFolder_();
  var folder = findEventFolder_(root, idEvento);
  if(folder){ folder.setName(idEvento + ' - ' + (nombre || '')); writeCell_('EVENTOS','ID_EVENTO', idEvento,'DriveURL', folder.getUrl()); return {ok:true, url: folder.getUrl()}; }
  return ensureEventFolder_(idEvento, nombre);
}
function findEventFolder_(root, idEvento){
  var it = root.getFolders();
  while(it.hasNext()){ var f = it.next();
    if(f.getName().indexOf(idEvento + ' -') === 0 || f.getName() === idEvento) return f; }
  return null;
}
function uploadEvidence_(p){
  var log = sheetToObjects_(getSS_().getSheetByName('LOGISTICA'));
  var item = log.filter(function(x){ return String(x.ID_LOG) === String(p.idLog); })[0];
  var idEvento = item ? item.Evento : 'GENERAL';
  var root = getRootFolder_();
  var folder = findEventFolder_(root, idEvento) || ensureFolderObj_(root, idEvento);
  var sub = getOrCreateSub_(folder, '03 Evidencias');
  var parts = p.dataUrl.split(',');
  var mime = (parts[0].match(/data:(.*?);/) || [null,'image/jpeg'])[1];
  var blob = Utilities.newBlob(Utilities.base64Decode(parts[1]), mime, p.filename || (p.idLog + '.jpg'));
  var file = sub.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  appendRow_('EVIDENCIAS', {ID_LOG:p.idLog, Evento:idEvento, Archivo:p.filename, URL:file.getUrl(),
                            Fecha: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')});
  return {ok:true, url:file.getUrl()};
}
function ensureFolderObj_(root, id){ var r = ensureEventFolder_(id, id); return DriveApp.getFolderById(r.folderId); }
function getOrCreateSub_(folder, name){ var it = folder.getFoldersByName(name); return it.hasNext() ? it.next() : folder.createFolder(name); }

/*************************************************************************
 * autorizar() — EJECUTAR UNA VEZ tras pegar el código.
 * Fuerza el consentimiento de permisos de Hojas, Drive y Calendario.
 *************************************************************************/
function autorizar(){
  getSS_();
  DriveApp.getRootFolder();
  var msg = 'Autorizado. ';
  try{ msg += 'Calendario: ' + getCal_().getName(); }catch(e){ msg += 'CALENDARIO NO ACCESIBLE → ' + e; }
  Logger.log(msg);
  return msg;
}

/*************************************************************************
 * setupSpreadsheet() — EJECUTAR UNA VEZ (crea hojas + siembra ejemplos)
 *************************************************************************/
function setupSpreadsheet(){
  var ss = getSS_();
  var schema = {
    EVENTOS:      ['ID_EVENTO','Nombre','Fecha','Color','Estado','Responsable','Descripcion','Activo','DriveURL'],
    PLANEACION:   ['ID_ACT','Fase','Evento','Fecha evento','Actividad','Tipo','Fecha inicio','Fecha fin','Actores','Evidencia','Observaciones','Responsable','Insumos','Estado','ID_CAL'],
    CRONOGRAMA:   ['ID_ACT','Evento','Actividad','Fecha inicio','Fecha fin','Estado'],
    PRESUPUESTO:  ['ID_LOG','Evento','Categoria','Elemento','Cantidad contratada','Valor'],
    LOGISTICA:    ['ID_LOG','Evento','Categoria','Elemento','Cantidad contratada','Cantidad entregada','Supervisor','Estado','Fecha','Hora','Observaciones'],
    EVIDENCIAS:   ['ID_LOG','Evento','Archivo','URL','Fecha'],
    RESPONSABLES: ['Nombre','Iniciales','Color','Cargo','Correo'],
    CONFIGURACION:['Clave','Valor'],
    HISTORIAL:    ['Usuario','Fecha','Hora','Campo','Anterior','Nuevo'],
    COMENTARIOS:  ['ID_ACT','Usuario','Fecha','Texto']
  };
  Object.keys(schema).forEach(function(name){
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if(!sh.getLastRow()) sh.appendRow(schema[name]);
  });
  seedIfEmpty_(ss,'RESPONSABLES',[
    ['Julieth','JR','#FF2E9A','Coordinadora de Juventudes','familia.cont6@zipaquira.gov.co'],
    ['Luisa','LU','#18B4FF','Apoyo administrativo',''],
    ['Nicolás','NF','#3DFF7E','Gestor de eventos',''],
    ['Alexis','AA','#FFE500','Emprendimiento',''],
    ['Valentina','VG','#8B2FD9','Participación juvenil','']
  ]);
  seedIfEmpty_(ss,'EVENTOS',[
    ['EV001','Premios Juventud','2026-09-18','#FF2E9A','En proceso','Julieth','Ceremonia de premiación al talento juvenil.','SI',''],
    ['EV002','Festival Urbano','2026-09-20','#18B4FF','En proceso','Nicolás','Tarima principal: hip hop, skate y muralismo.','SI',''],
    ['EV003','Feria de Emprendimiento','2026-09-22','#3DFF7E','Pendiente','Alexis','Jóvenes Tiburones / Shark Tank juvenil.','SI',''],
    ['EV004','Foro de Participación','2026-09-24','#8B2FD9','No iniciado','Valentina','CMJ, Plataforma y CCyD.','SI',''],
    ['EV005','Cierre Semana Juventud','2026-09-26','#FFE500','No iniciado','Luisa','Clausura y reconocimiento.','SI','']
  ]);
  sheetToObjects_(ss.getSheetByName('EVENTOS')).forEach(function(e){ ensureEventFolder_(e.ID_EVENTO, e.Nombre); });
  try{ getCal_(); }catch(e){}
  var url = ss.getUrl();
  Logger.log('OK — Estructura creada. Base de datos: ' + url);
  return url;
}
function seedIfEmpty_(ss, name, rows){
  var sh = ss.getSheetByName(name);
  if(sh.getLastRow() <= 1){ rows.forEach(function(r){ sh.appendRow(r); }); }
}
