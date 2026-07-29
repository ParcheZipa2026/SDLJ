# Centro de Operaciones · Semana de la Juventud 2026

Plataforma web para planear, hacer seguimiento, supervisar y dejar trazabilidad de la **Semana de la Juventud 2026** (18–26 de septiembre) de la Alcaldía de Zipaquirá — Secretaría de Familia y Desarrollo Social.

Identidad urbana, una sola página, sin dependencias externas, sincronizada con **Google Sheets + Google Drive** vía Apps Script y publicable en **GitHub Pages**.

---

## Demo en vivo

Una vez actives GitHub Pages, la plataforma queda en:

```
https://<tu-usuario>.github.io/<nombre-del-repo>/
```

Arranca conectada a Google Sheets (modo **Live**). Si el backend no responde, muestra datos de ejemplo (modo **Demo**) para no quedar en blanco.

---

## Qué incluye

- **Dashboard** con cuenta regresiva, avance real vs. esperado, retraso y alertas.
- **5 vistas** de la planeación: Tabla, Kanban, Calendario, Gantt y Cronograma.
- **Logística** de verificación de entrega (checklist + banco de evidencias en Drive).
- **Responsables**, carga laboral e indicadores por persona.
- **Comentarios con menciones**, historial de cambios y exportación a Excel / Word / PDF.
- **Asistente** que responde preguntas analizando los datos del proyecto.

## Tecnología

HTML + CSS + JavaScript (vanilla, sin frameworks ni Bootstrap) · Google Apps Script · Google Sheets · Google Drive. Tipografías vía Google Fonts (Anton, Inter, Space Mono) e iconos Material Symbols.

## Estructura del repositorio

| Archivo | Descripción |
|---|---|
| `index.html` | La plataforma completa (front-end autocontenido). Es lo que sirve GitHub Pages. |
| `Codigo-Apps-Script.gs` | Backend: API sobre Google Sheets + Drive. Va en el editor de Apps Script, **no** en Pages. |
| `GUIA-DESPLIEGUE.md` | Cómo conectar Sheets, crear el Web App y entender cada módulo. |
| `PUBLICAR-EN-GITHUB.md` | Paso a paso para subir y publicar este repositorio. |
| `.nojekyll` | Evita que GitHub Pages procese el sitio con Jekyll. |

## Puesta en marcha rápida

1. La URL del Web App ya viene preconfigurada en `index.html`. Cualquiera puede cambiarla desde la vista **Configuración** (se guarda en su navegador).
2. Publica el repositorio en GitHub Pages siguiendo **[PUBLICAR-EN-GITHUB.md](PUBLICAR-EN-GITHUB.md)**.
3. Detalle de las hojas y del backend en **[GUIA-DESPLIEGUE.md](GUIA-DESPLIEGUE.md)**.

---

Secretaría de Familia y Desarrollo Social · Programa de Juventudes · Alcaldía de Zipaquirá.
