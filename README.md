# ObSave

[![Release](https://img.shields.io/github/v/release/adastraforge/obsave?label=release&sort=semver)](https://github.com/adastraforge/obsave/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7c3aed?logo=obsidian&logoColor=white)](https://obsidian.md)
[![Desktop only](https://img.shields.io/badge/Desktop-only-informational)](manifest.json)

**Sincronización multi-proveedor para Obsidian** — respaldo y sync directo con GitHub, Google Drive y más, sin intermediarios comerciales.

Desarrollado por [Ad Astra Forge](https://github.com/adastraforge). 100 % gratuito y open source (MIT).

---

## Características

- **Un proveedor activo a la vez** — GitHub (Git/Isomorphic-Git), Google Drive (OAuth2 PKCE), OneDrive e iCloud (próximamente).
- **Sin servidores propios** — ObSave se comunica directamente con las APIs del proveedor que elijas.
- **Wizard de configuración** integrado en Ajustes de Obsidian.
- **Sync automático** configurable (intervalo 1–15 min) e indicadores visuales en el explorador de archivos.
- **Privacidad local** — credenciales almacenadas solo en tu dispositivo.

## Instalación

### Desde GitHub Releases

1. Descarga `main.js`, `manifest.json` y `styles.css` del [último release](https://github.com/adastraforge/obsave/releases).
2. Copia los archivos a `.obsidian/plugins/obsave/` en tu bóveda.
3. Activa el plugin en **Ajustes → Complementos de la comunidad**.

### Con BRAT

Añade el repositorio `https://github.com/adastraforge/obsave` en el plugin [BRAT](https://github.com/TfTHacker/obsidian42-brat) e instala ObSave desde allí.

## Configuración

### GitHub

1. Abre **Ajustes → ObSave**.
2. Selecciona **GitHub** como proveedor.
3. Indica la URL del repositorio y un [Personal Access Token](https://github.com/settings/tokens) con permisos `repo`.
4. Elige bóveda nueva o existente y completa el wizard.

### Google Drive

1. Abre **Ajustes → ObSave** y selecciona **Google Drive**.
2. Pulsa **Conectar con Google Drive** — se abrirá el navegador para autorizar vía OAuth 2.0 (PKCE).
3. ObSave escuchará el callback en `http://127.0.0.1:42000/callback` y guardará los tokens localmente.

#### Privacidad bajo el scope `drive.file`

Google Drive se conecta con el scope restringido:

```
https://www.googleapis.com/auth/drive.file
```

Esto significa que ObSave **solo puede acceder a archivos y carpetas que el propio plugin crea o abre** en tu Drive. No tiene acceso al resto de documentos de tu cuenta. Las credenciales OAuth2 se guardan **únicamente en la configuración local de Obsidian** en tu dispositivo; Ad Astra Forge no recibe ni almacena tus tokens.

Más detalles en la [Política de Privacidad](PRIVACY.md).

## Documentación legal

| Documento | Enlace |
|-----------|--------|
| **Política de Privacidad** | [PRIVACY.md](https://github.com/adastraforge/obsave/blob/main/PRIVACY.md) |
| **Términos de Servicio** | [TERMS.md](https://github.com/adastraforge/obsave/blob/main/TERMS.md) |

## Desarrollo

```bash
npm ci
npm run dev      # watch mode
npm run build    # producción → main.js
```

Para builds con Google Drive OAuth en local:

```bash
OBSAVE_GOOGLE_CLIENT_ID="tu-client-id.apps.googleusercontent.com" npm run build
```

En CI, el workflow de release inyecta `OBSAVE_GOOGLE_CLIENT_ID` desde GitHub Secrets.

## Soporte

- **Email:** [soporte@adastraforge.com](mailto:soporte@adastraforge.com)
- **Issues:** [github.com/adastraforge/obsave/issues](https://github.com/adastraforge/obsave/issues)

## Licencia

MIT — © Ad Astra Forge
