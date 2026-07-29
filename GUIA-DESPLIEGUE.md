# Centro de Operaciones · Semana de la Juventud
### Guía de despliegue y arquitectura

Plataforma web de gestión, seguimiento, supervisión y trazabilidad, con identidad urbana, sincronizada con Google Workspace y desplegable en GitHub Pages. Funciona en dos modos: **Demo** (datos de ejemplo, sin backend) y **Live** (datos reales desde Google Sheets + Drive).

---

## Contenido del paquete

| Archivo | Qué es |
|---|---|
| `index.html` | La plataforma completa (front-end autocontenido: HTML + CSS + JS, sin dependencias, sin Bootstrap). |
| `Codigo-Apps-Script.gs` | El backend: API sobre Google Sheets + Google Drive con historial y evidencias. |
| `GUIA-DESPLIEGUE.md` | Este documento. |

---

## Paso 1 · Ver la plataforma ya (modo Demo)

Abre `index.html` en el navegador (o súbelo a GitHub Pages). Arranca en **modo Demo** con eventos, actividades y logística de ejemplo, así que puedes recorrer todas las vistas de inmediato: Dashboard, Planeación, Kanban, Calendario, Gantt, Cronograma, Eventos, Logística, Responsables, Alertas y el Asistente IA.

## Paso 2 · Conectar Google Sheets (modo Live)

1. Crea un **Google Sheet** nuevo (será la base de datos).
2. `Extensiones → Apps Script`. Borra el contenido y pega **`Codigo-Apps-Script.gs`**. Guarda.
3. Ejecuta una vez la función **`setupSpreadsheet`** (menú ▶). Autoriza los permisos. Esto crea las 10 hojas con sus encabezados, siembra eventos y responsables de ejemplo, y crea la carpeta raíz en Drive con la estructura de cada evento.
4. `Implementar → Nueva implementación → Aplicación web`:
   - **Ejecutar como:** Yo
   - **Quién tiene acceso:** Cualquier usuario
5. Copia la **URL** que termina en `/exec`.
6. Abre la plataforma → vista **Configuración** → pega la URL → **Conectar**. El indicador cambiará a **Live** y empezará a leer/escribir en tus hojas.

## Paso 3 · Publicar en GitHub Pages

Igual que hiciste con el Observatorio: sube `index.html` a un repositorio, activa Pages sobre la rama principal y listo. La URL del Web App queda guardada en el navegador de cada usuario, no en el código.

---

## Las 10 hojas

`EVENTOS` · `PLANEACION` · `CRONOGRAMA` · `PRESUPUESTO` · `LOGISTICA` · `EVIDENCIAS` · `RESPONSABLES` · `CONFIGURACION` · `HISTORIAL` · `COMENTARIOS`

**Columnas dinámicas:** si agregas una columna nueva a `PLANEACION` en Google Sheets, aparece automáticamente en la tabla y en el detalle de la actividad sin tocar el código.

**La llave siempre es el ID** (`ID_EVENTO`, `ID_ACT`, `ID_LOG`), nunca el nombre. Si cambias el nombre de un evento, el backend renombra su carpeta de Drive sin romper enlaces ni duplicarla.

---

## Qué hace cada módulo

- **Dashboard** — cuenta regresiva al 18 de septiembre, avance real vs. esperado, retraso, eventos activos, actividades críticas/vencidas, alertas y próximos eventos.
- **Planeación** — tabla con columnas dinámicas; clic en una fila abre el detalle editable con comentarios y menciones (`@Luisa`).
- **Kanban** — arrastra tarjetas entre estados; el cambio se guarda y queda en el historial.
- **Calendario / Gantt / Cronograma** — tres lecturas de las mismas fechas (barras estilo Project, línea de tiempo, mes).
- **Logística** — verificación de entrega del operador (no controla presupuesto ni pagos): checklist de 6 puntos por elemento y banco de hasta 5 fotos por ítem que se suben a Drive.
- **Responsables** — carga laboral e indicadores de cumplimiento por persona.
- **Alertas** — vencidas, sin responsable, sin fecha, sin estado, bloqueadas y entregables pendientes.
- **Asistente IA** — responde ya (motor local) las 8 preguntas del PRD analizando tus datos. La arquitectura queda lista para conectar un LLM: la función `AI.buildContext()` arma el contexto que se enviaría a Claude / GPT / Gemini.

---

## Escalabilidad

Para un proyecto nuevo (Semana 2027, Festival, Casa de la Juventud, Escuela de Liderazgo, etc.) basta con un Google Sheet nuevo con las mismas hojas y una implementación del mismo `.gs`. El código no cambia; solo cambian los datos y la URL del Web App.

---

## Alcance de esta versión (sé transparente)

Esta es una **base sólida y desplegable (Sprint 1)** que cubre el núcleo del PRD end-to-end: identidad visual, las 5 vistas, dashboard, alertas, logística con evidencias, historial, comentarios con menciones, exportar (Excel/Word/PDF) y el backend real de Sheets + Drive.

Quedan como **siguientes iteraciones** (arquitectura ya preparada, no implementadas al 100%): dependencias visuales entre barras del Gantt, notificaciones push reales por mención, edición en línea de cada celda de la tabla, y la conexión del asistente a un LLM en vivo (hoy responde con el motor local). Puedo abordarlas cuando quieras.
