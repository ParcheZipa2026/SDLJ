# Publicar en GitHub Pages

Dos caminos. El **A (web)** es el más fácil y no requiere instalar nada. El **B (Git)** es por consola, como cuando publicaste el Observatorio.

> La URL de tu Web App ya viene dentro de `index.html`, así que al publicar, el sitio queda conectado a Google Sheets automáticamente.

---

## Camino A · Desde la web de GitHub (recomendado)

1. Entra a **github.com** e inicia sesión.
2. Botón **New** (nuevo repositorio). Nombre sugerido: `centro-operaciones-juventud`. Déjalo **Public**. Crear.
3. En el repositorio vacío: **Add file → Upload files**.
4. Arrastra **todos** los archivos de esta carpeta:
   `index.html`, `Codigo-Apps-Script.gs`, `README.md`, `GUIA-DESPLIEGUE.md`, `PUBLICAR-EN-GITHUB.md`, `.gitignore` y `.nojekyll`.
   - Si `.nojekyll` no aparece al arrastrar (por empezar con punto), no te preocupes: crea el archivo con **Add file → Create new file**, escribe `.nojekyll` como nombre, déjalo vacío y confirma.
5. Abajo, **Commit changes**.
6. Ve a **Settings → Pages**.
7. En **Build and deployment → Source**, elige **Deploy from a branch**.
8. **Branch:** `main` · **Folder:** `/ (root)` · **Save**.
9. Espera 1–2 minutos. GitHub te mostrará la URL pública:
   `https://<tu-usuario>.github.io/centro-operaciones-juventud/`

Listo. Abre esa URL y verás la plataforma en modo Live.

---

## Camino B · Desde la terminal (Git)

Dentro de esta carpeta:

```bash
git init
git add .
git commit -m "Centro de Operaciones - Semana de la Juventud 2026"
git branch -M main
git remote add origin https://github.com/<tu-usuario>/centro-operaciones-juventud.git
git push -u origin main
```

Luego activa Pages igual que en los pasos **6–9** del Camino A.

---

## Verificar que el backend responde

Abre en el navegador tu URL de Apps Script con `?action=ping` al final:

```
https://script.google.com/macros/s/AKfycbxcU_otxmylfHqMzRe3RGhtz5UZdqo2dNxSnZc9O8ZRG6cHGLWuGnEdtxHhepEr5EGk/exec?action=ping
```

Debe mostrar algo como:

```json
{"ok":true,"msg":"Centro de Operaciones activo"}
```

Si lo ves, la plataforma leerá y escribirá en tus hojas. Si en cambio la app aparece en modo Demo, revisa que en Apps Script el Web App esté implementado con acceso **Cualquier usuario** y que hayas ejecutado `setupSpreadsheet` una vez.

---

## Cambiar la URL sin re-publicar

Si algún día reimplementas el Web App y cambia la URL `/exec`, no necesitas volver a subir el repositorio: entra a la plataforma → vista **Configuración** → pega la nueva URL → **Conectar**. Queda guardada en tu navegador.
