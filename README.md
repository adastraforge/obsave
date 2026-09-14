# ObSave

[![Release](https://img.shields.io/github/v/release/adastraforge/obsave?label=release&sort=semver)](https://github.com/adastraforge/obsave/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7c3aed?logo=obsidian&logoColor=white)](https://obsidian.md)

**Suite de productividad local para Obsidian** — captura de notas, estructura de bóveda e informe operativo, sin nube ni intermediarios.

Desarrollado por [Ad Astra Forge](https://github.com/adastraforge). 100 % gratuito y open source (MIT).

---

## Características

- **100 % local** — opera sobre el sistema de archivos nativo de Obsidian. Sin OAuth, sin proveedores de nube y sin sincronización en segundo plano.
- **ObSave Hub** — panel lateral con nota rápida, nueva nota y el informe operativo (KPI, dona de salud, volumen por carpeta y tareas pendientes/vencidas).
- **Nota rápida y nueva nota** — plantilla YAML mínima, sanitizado de nombres y cursor en el cuerpo.
- **Estructura de bóveda** — genera las carpetas plantilla (`00_Diarias` … `05_Archivadas`) en un clic.

## Instalación

### Desde GitHub Releases

1. Descarga `main.js`, `manifest.json` y `styles.css` del [último release](https://github.com/adastraforge/obsave/releases).
2. Copia los archivos a `.obsidian/plugins/obsave/` en tu bóveda.
3. Activa el plugin en **Ajustes → Complementos de la comunidad**.

### Con BRAT

Añade el repositorio `https://github.com/adastraforge/obsave` en el plugin [BRAT](https://github.com/TfTHacker/obsidian42-brat) e instala ObSave desde allí.

## Uso

1. Abre el **ObSave Hub** desde el ribbon o el comando «Abrir ObSave Hub lateral».
2. Usa **Nota rápida** (`zap`) o **Nueva nota** (`file-plus`) para capturar.
3. En **Ajustes → ObSave** genera las carpetas de plantilla si aún no existen.

Comandos activos:

- ObSave: Abrir panel principal de ObSave
- ObSave: Abrir ObSave Hub lateral
- ObSave: Crear nota rápida ObSave
- ObSave: Crear nueva nota ObSave

## Desarrollo

```bash
npm ci
npm run dev      # watch mode
npm run build    # producción → main.js
```

## Soporte

- **Email:** [soporte@adastraforge.com](mailto:soporte@adastraforge.com)
- **Issues:** [github.com/adastraforge/obsave/issues](https://github.com/adastraforge/obsave/issues)

## Licencia

MIT — © Ad Astra Forge
