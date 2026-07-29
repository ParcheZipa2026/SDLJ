/*************************************************************************
 * CENTRO DE OPERACIONES · SEMANA DE LA JUVENTUD — BACKEND (Apps Script)
 * -----------------------------------------------------------------------
 * Expone una API JSON sobre Google Sheets + Google Drive para la
 * plataforma web (index.html). Modular y documentado.
 *
 * ENDPOINTS
 *   GET  ?action=ping                         → prueba de vida
 *   GET  ?action=bootstrap                    → todas las hojas en JSON
 *   POST {action:"update", sheet, idField, idValue, field, value}
 *   POST {action:"create", sheet, row:{...}}
 *   POST {action:"comment", row:{ID_ACT,Usuario,Fecha,Texto}}
 *   POST {action:"logcheck", idField, idValue, field, value}
 *   POST {action:"uploadEvidence", idLog, filename, dataUrl}
 *   POST {action:"createEventFolder", idEvento, nombre}
 *   POST {action:"renameEventFolder", idEvento, nombre}
 *
 * REGLAS CLAVE (del PRD)
 *   - La llave SIEMPRE es ID_EVENTO / ID_ACT / ID_LOG. Nunca el nombre.
 *   - Toda escritura queda registrada en HISTORIAL (trazabilidad).
 *   - Las evidencias se guardan en Drive; en Sheets solo va la URL.
 *   - Las carpetas de evento se renombran, nunca se duplican.
 *
 * INSTALACIÓN
 *   1. Crea un Google Sheet. Extensiones → Apps Script. Pega este código.
 *   2. Ejecuta una vez la función setupSpreadsheet() (crea hojas + carpeta
 *      raíz en Drive y siembra datos de ejemplo). Autoriza los permisos.
 *   3. Implementar → Nueva implementación → Aplicación web:
 *        Ejecutar como: Yo   |   Acceso: Cualquier usuario
 *   4. Copia la URL (/exec) y pégala en la vista Configuración de la app.
 *************************************************************************/

// ====== CONFIGURACIÓN ======
var ROOT_FOLDER_NAME = 'Semana de la Juventud 2026';
var SHEETS = ['EVENTOS','PLANEACION','CRONOGRAMA','PRESUPUESTO','LOGISTICA',
              'EVIDENCIAS','RESPONSABLES','CONFIGURACION','HISTORIAL','COMENTARIOS'];
// Subcarpetas estándar por evento (Drive)
var EVENT_SUBFOLDERS = ['01 Planeación','02 Oficios','03 Evidencias','04 Fotografías',
                        '05 Videos','06 Logística','07 Informes','08 Prensa','09 Actas'];

// ====== HOJA DE CÁLCULO (funciona con script independiente o unido a una hoja) ======
// Si el script está unido a una hoja, la usa. Si es independiente, abre la que
// esté guardada por ID en las propiedades del script; si no existe, la crea una
// sola vez y recuerda su ID. Así setupSpreadsheet() nunca recibe null.
function getSS_(){
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if(active) return active;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SS_ID');
  if(id){
    try{ return SpreadsheetApp.openById(id); }catch(e){ /* id inválido: se recrea abajo */ }
  }
  var ss = SpreadsheetApp.create('Semana de la Juventud — Base de datos');
  props.setProperty('SS_ID', ss.getId());
  Logger.log('Hoja de cálculo creada: ' + ss.getUrl());
  return ss;
}

// ====== ROUTER ======
function doGet(e){
  var action = (e && e.parameter && e.parameter.action) || 'ping';
  try{
    if(action === 'ping')      return json({ok:true, msg:'Centro de Operaciones activo'});
    if(action === 'bootstrap') return json(bootstrap_());
    return json({ok:false, error:'acción GET desconocida: '+action});
  }catch(err){ return json({ok:false, error:String(err)}); }
}

function doPost(e){
  var p;
  try{ p = JSON.parse(e.postData.contents); }
  catch(err){ return json({ok:false, error:'JSON inválido'}); }
  try{
    switch(p.action){
      case 'update':            return json(updateField_(p));
      case 'create':            return json(createRow_(p));
      case 'comment':           return json(appendRow_('COMENTARIOS', p.row));
      case 'logcheck':          return json(logCheck_(p));
      case 'uploadEvidence':    return json(uploadEvidence_(p));
      case 'createEventFolder': return json(ensureEventFolder_(p.idEvento, p.nombre));
      case 'renameEventFolder': return json(renameEventFolder_(p.idEvento, p.nombre));
      default: return json({ok:false, error:'acción POST desconocida: '+p.action});
    }
  }catch(err){ return json({ok:false, error:String(err)}); }
}

// ====== LECTURA ======
// Devuelve cada hoja como arreglo de objetos usando la fila 1 como encabezados
// (detección dinámica de columnas: agrega una columna en Sheets y aparece sola).
function bootstrap_(){
  var out = {ok:true};
  var ss = getSS_();
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

// ====== ESCRITURA ======
function updateField_(p){
  var ss = getSS_();
  var sh = ss.getSheetByName(p.sheet);
  if(!sh) throw 'Hoja no existe: '+p.sheet;
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var idCol = headers.indexOf(p.idField);
  var fieldCol = headers.indexOf(p.field);
  if(idCol < 0) throw 'Columna llave no existe: '+p.idField;
  if(fieldCol < 0){ // si la columna no existe, la creamos al final (columnas dinámicas)
    fieldCol = headers.length;
    sh.getRange(1, fieldCol+1).setValue(p.field);
  }
  for(var r=1; r<data.length; r++){
    if(String(data[r][idCol]) === String(p.idValue)){
      var prev = data[r][fieldCol];
      sh.getRange(r+1, fieldCol+1).setValue(p.value);
      logHistory_(p.field+' ('+p.idValue+')', prev, p.value);
      // Si cambió el nombre de un evento → renombrar su carpeta en Drive
      if(p.sheet === 'EVENTOS' && p.field === 'Nombre'){
        renameEventFolder_(p.idValue, p.value);
      }
      return {ok:true};
    }
  }
  throw 'Registro no encontrado: '+p.idValue;
}

function createRow_(p){ appendRow_(p.sheet, p.row);
  if(p.sheet === 'EVENTOS' && p.row.ID_EVENTO) ensureEventFolder_(p.row.ID_EVENTO, p.row.Nombre);
  return {ok:true}; }

// Inserta un objeto respetando (y ampliando) los encabezados existentes.
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

function logCheck_(p){
  var ss = getSS_();
  var sh = ss.getSheetByName('LOGISTICA');
  if(!sh) return {ok:false, error:'Sin hoja LOGISTICA'};
  // Guarda el checklist como JSON en la columna "Checklist"
  return updateField_({sheet:'LOGISTICA', idField:p.idField, idValue:p.idValue,
                       field:'Check_'+p.field, value: p.value ? 'SI' : ''});
}

// ====== HISTORIAL (trazabilidad) ======
function logHistory_(campo, anterior, nuevo){
  var ss = getSS_();
  var sh = ss.getSheetByName('HISTORIAL') || ss.insertSheet('HISTORIAL');
  if(!sh.getLastRow()) sh.appendRow(['Usuario','Fecha','Hora','Campo','Anterior','Nuevo']);
  var now = new Date();
  var email = (Session.getActiveUser().getEmail()) || 'sistema';
  sh.appendRow([email,
    Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    Utilities.formatDate(now, Session.getScriptTimeZone(), 'HH:mm'),
    campo, anterior, nuevo]);
}

// ====== GOOGLE DRIVE ======
function getRootFolder_(){
  var it = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);
}

// Crea (o reutiliza) la carpeta del evento con sus 9 subcarpetas.
// Formato: "EV001 - Premios Juventud". Nunca duplica.
function ensureEventFolder_(idEvento, nombre){
  var root = getRootFolder_();
  var folder = findEventFolder_(root, idEvento);
  var target = idEvento + ' - ' + (nombre || '');
  if(!folder){ folder = root.createFolder(target); }
  else if(folder.getName() !== target){ folder.setName(target); } // renombra si cambió
  EVENT_SUBFOLDERS.forEach(function(sub){
    if(!folder.getFoldersByName(sub).hasNext()) folder.createFolder(sub);
  });
  return {ok:true, folderId: folder.getId(), url: folder.getUrl()};
}

function renameEventFolder_(idEvento, nombre){
  var root = getRootFolder_();
  var folder = findEventFolder_(root, idEvento);
  if(folder){ folder.setName(idEvento + ' - ' + (nombre || '')); return {ok:true, url:folder.getUrl()}; }
  return ensureEventFolder_(idEvento, nombre); // si no existía, la crea
}

// Busca la carpeta por PREFIJO de ID (la llave), no por nombre completo.
function findEventFolder_(root, idEvento){
  var it = root.getFolders();
  while(it.hasNext()){ var f = it.next();
    if(f.getName().indexOf(idEvento + ' -') === 0 || f.getName() === idEvento) return f; }
  return null;
}

// Guarda una foto (dataURL base64) en la subcarpeta 03 Evidencias del evento
// del elemento logístico, y devuelve la URL para guardarla en Sheets.
function uploadEvidence_(p){
  var ss = getSS_();
  var log = sheetToObjects_(ss.getSheetByName('LOGISTICA'));
  var item = log.filter(function(x){ return String(x.ID_LOG) === String(p.idLog); })[0];
  var idEvento = item ? item.Evento : 'GENERAL';
  var root = getRootFolder_();
  var folder = findEventFolder_(root, idEvento) || ensureFolderObj_(root, idEvento);
  var sub = getOrCreateSub_(folder, '03 Evidencias');
  var parts = p.dataUrl.split(',');
  var meta = parts[0], b64 = parts[1];
  var mime = (meta.match(/data:(.*?);/) || [null,'image/jpeg'])[1];
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, p.filename || (p.idLog+'.jpg'));
  var file = sub.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  // Registra la URL en EVIDENCIAS
  appendRow_('EVIDENCIAS', {ID_LOG:p.idLog, Evento:idEvento, Archivo:p.filename, URL:file.getUrl(),
                            Fecha: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')});
  return {ok:true, url:file.getUrl()};
}
function ensureFolderObj_(root, id){ var r = ensureEventFolder_(id, id); return DriveApp.getFolderById(r.folderId); }
function getOrCreateSub_(folder, name){ var it=folder.getFoldersByName(name); return it.hasNext()?it.next():folder.createFolder(name); }

// ====== UTILIDAD DE RESPUESTA ======
function json(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/*************************************************************************
 * setupSpreadsheet()  — EJECUTAR UNA SOLA VEZ
 * Crea todas las hojas con sus encabezados y siembra datos de ejemplo,
 * además de la carpeta raíz en Drive. Idéntico esquema al de la app.
 *************************************************************************/
function setupSpreadsheet(){
  var ss = getSS_();
  var schema = {
    EVENTOS:      ['ID_EVENTO','Nombre','Fecha','Color','Estado','Responsable','Descripcion','Activo'],
    PLANEACION:   ['ID_ACT','Fase','Evento','Fecha evento','Actividad','Tipo','Fecha inicio','Fecha fin','Actores','Evidencia','Observaciones','Responsable','Insumos','Estado'],
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
  // Semillas mínimas
  seedIfEmpty_(ss,'RESPONSABLES',[
    ['Julieth','JR','#FF2E9A','Coordinadora de Juventudes','familia.cont6@zipaquira.gov.co'],
    ['Luisa','LU','#18B4FF','Apoyo administrativo',''],
    ['Nicolás','NF','#3DFF7E','Gestor de eventos',''],
    ['Alexis','AA','#FFE500','Emprendimiento',''],
    ['Valentina','VG','#8B2FD9','Participación juvenil','']
  ]);
  seedIfEmpty_(ss,'EVENTOS',[
    ['EV001','Premios Juventud','2026-09-18','#FF2E9A','En proceso','Julieth','Ceremonia de premiación al talento juvenil.','SI'],
    ['EV002','Festival Urbano','2026-09-20','#18B4FF','En proceso','Nicolás','Tarima principal: hip hop, skate y muralismo.','SI'],
    ['EV003','Feria de Emprendimiento','2026-09-22','#3DFF7E','Pendiente','Alexis','Jóvenes Tiburones / Shark Tank juvenil.','SI'],
    ['EV004','Foro de Participación','2026-09-24','#8B2FD9','No iniciado','Valentina','CMJ, Plataforma y CCyD.','SI'],
    ['EV005','Cierre Semana Juventud','2026-09-26','#FFE500','No iniciado','Luisa','Clausura y reconocimiento.','SI']
  ]);
  // Carpetas de Drive de cada evento
  sheetToObjects_(ss.getSheetByName('EVENTOS')).forEach(function(e){
    ensureEventFolder_(e.ID_EVENTO, e.Nombre);
  });
  var _url = getSS_().getUrl();
  Logger.log('OK — Estructura creada. Base de datos: ' + _url);
  return _url;
}
function seedIfEmpty_(ss, name, rows){
  var sh = ss.getSheetByName(name);
  if(sh.getLastRow() <= 1){ rows.forEach(function(r){ sh.appendRow(r); }); }
}
