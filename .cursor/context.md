# ObSave — Contexto del Proyecto

## Marca y Visión
**Ad Astra Forge** desarrolla **ObSave**, un plugin open-source y gratuito para Obsidian orientado a la sincronización multi-repositorio y auto-respaldo **sin intermediarios comerciales**.

El usuario mantiene control total de sus datos: el vault se sincroniza con **un único proveedor de nube** a la vez (GitHub, Google Drive, OneDrive o iCloud).

## Fase Actual: Fase 1 — MVP Git Core Simplificado

> **Estado de release:** Fase 1 **publicada oficialmente** — `v1.0.12`  
> GitHub Release: `https://github.com/adastraforge/obsave/releases/tag/v1.0.12`  
> BRAT: `https://github.com/adastraforge/obsave` — artefactos: `manifest.json` + `main.js` + `styles.css`  
> Pipeline: `.github/workflows/release.yml` (trigger: push tag `v*`)

### OAuth2 Google Drive v1.0.12
- **PKCE:** `code_verifier` / `code_challenge` (Web Crypto API).
- **Callback:** servidor HTTP efímero `http://127.0.0.1:42000/callback`.
- **Tokens:** intercambio `authorization_code` + renovación automática con `refresh_token`.
- **Wizard:** botón «Conectar con Google Drive»; guarda `activeProvider = 'gdrive'` y perfil (email/nombre).
- **Build:** definir `OBSAVE_GOOGLE_CLIENT_ID` al compilar (OAuth public client).

### Badges wizard v1.0.11
- **Sin badge** en tarjetas seleccionables no conectadas (GitHub, Google Drive).
- **🟢 Conectado** (`.is-connected`) solo si hay credenciales almacenadas para ese proveedor.
- **Próximamente** (`.is-soon`) solo en OneDrive e iCloud.
- Google Drive seleccionable → pantalla placeholder OAuth (`gdrive-setup`).

### Wizard proveedor v1.0.10
- **Paso 1:** tarjetas de selección — GitHub (activo), Google Drive / OneDrive / iCloud (badge «Próximamente»).
- **Paso 2–3:** flujo GitHub existente (bóveda nueva / existente + PAT).
- **Navegación:** botón «← Volver a selección de proveedor» en pantallas GitHub.

### Arquitectura proveedor único (Fase 2 prep)
- **`activeProvider`:** `'github' | 'gdrive' | 'onedrive' | 'icloud'` — un solo backend activo, sin réplicas espejo.
- **`IStorageProvider`:** contrato común (`connect`, `sync`, `disconnect`) en `src/providers/`.
- **Implementado:** `GitHubProvider` (Isomorphic-Git). **Skeletons Fase 2:** Google Drive, OneDrive, iCloud.
- **Migración:** `data.json` legacy con `masterRepo` → `activeProvider: 'github'`.

### Decoradores v1.0.8
- **`styles.css`:** puntos `.obsave-dot-new|modified|synced` incluidos en release (3 artefactos obligatorios).
- **DOM Explorador:** spans inyectados en `.nav-file-title[data-path]` / `.nav-file[data-path]`; refresco en `layout-change`, `vault.modify` y post-sync.

### UI visual v1.0.7
- **Decoradores en Explorador:** puntos de color junto a cada `.md` — rojo (nuevo local), amarillo (modificado/pendiente), verde (sincronizado con remoto).
- **Sync silencioso:** timer y `onload` no muestran `Notice` si no hay cambios; solo consola + badges. Manual y errores siguen notificando.

### Last-Write-Wins v1.0.6
- **Sin duplicación:** eliminados prefijos `[Local]` / `[Sync]` y copias con sufijo de fecha en sync.
- **Política LWW:** gana la versión con timestamp más reciente; rutas originales intactas (`Prueba_1.md`, etc.).
- **Merge:** `fastForwardOnly: false` + `checkout({ force: true })`; push con reintento fetch+merge.

### Pipeline remoto-first v1.0.5
- **Orden:** fetch → merge/checkout remoto → commit local → push.
- **Conflictos .md:** fallback `[Local]` + `[Sync]` con notificación al usuario.
- **UI:** `lastSyncAt` formateado como `YYYY-MM-DD HH:mm:ss` (hora local).

### Motor Git real v1.0.4
- **`performSync()`:** pipeline A (local commit) → B (fetch/merge/checkout) → C (push).
- **Fast-path:** sin cambios locales + HEAD idéntico → ciclo en ~0.5s.
- **Exclusiones:** `.obsidian/` omitido del escaneo `statusMatrix`.
- **Notificaciones:** mensajes precisos (subidos/descargados/al día).
- **`lastSyncAt`:** persistido en cada sync exitosa vía `saveSettings()`.

### Correcciones v1.0.3
- **Persistencia:** `mergeStoredSettings()` preserva `masterRepo` y credenciales de `data.json` al cargar.
- **Sin renombrado físico:** el nombre del repo se guarda solo en metadatos ObSave; la carpeta del vault no se mueve.
- **Git push:** fetch + merge remoto antes de push; reintento ante rechazo non-fast-forward.
- **UI:** versión en footer; autocompletado de usuario GitHub desde URL en Paso 1-B.

### UI y sync (v1.0.2)
- **Badge de versión:** cabecera de ajustes muestra `ObSave vX.Y.Z — Sincronización multi-repositorio`.
- **Slider nativo:** intervalo 1–15 min con descripción `Cada X minutos`.
- **Desconectar:** sección "Gestión de Conexión" resetea Master, credenciales y vuelve al wizard.

### Sincronización automática (v1.0.1)
- **Al iniciar:** sync automático en `onload()` (comportamiento fijo, sin toggle).
- **Intervalo:** slider 1–15 minutos en Ajustes; `setInterval` en `main.ts`.
- **Renombrado local:** wizard PASO 1-A usa `FileSystemAdapter` + ruta retornada post-rename.

### Objetivo de la Fase 1
Núcleo del plugin con Git simplificado mediante **Isomorphic-Git** y un **Wizard de Primera Sincronización**:

| Entregable | Estado |
|------------|--------|
| Configuración persistente (`ObSaveSettings`) | ✅ |
| UI: pestaña de ajustes + ribbon con estado | ✅ |
| `GitAdapter` con Isomorphic-Git | ✅ |
| Wizard PASO 1-A (repo nuevo) | ✅ |
| Wizard PASO 1-B (repo existente + fusión inteligente) | ✅ |
| Resolución de conflictos por duplicado local | ✅ |
| Pipeline build TypeScript → esbuild | ✅ |
| `SyncEngine` stub (réplicas en Fase 3) | ✅ |

### Wizard de Primera Sincronización
- **PASO 1-A (Repo Nuevo):** Usuario + token → sugerencia de nombre de carpeta → creación en GitHub + init `.git` + push a `main`.
- **PASO 1-B (Repo Existente):** URL + credenciales → fusión inteligente (remoto → local → push) → prompt de renombrado si los nombres difieren.
- **Conflictos:** La versión local se duplica con sufijo `(Copia de conflicto local YYYY-MM-DD)`.

### Fuera de Alcance (Fases Posteriores)
- Conectores OAuth2 PKCE completos (Fase 2)
- Réplicas automáticas en la nube (Fase 3)
- Sync periódico en background (Fase 3)

## Premisas Inviolables
1. **Gratuidad y transparencia** — sin paywalls ni conectores bloqueados.
2. **OAuth2 PKCE directo** — redirección nativa del navegador, sin `obsidian://` frágil.
3. **Proveedor único de nube** — un backend activo por bóveda; sin réplicas espejo automáticas.
4. **Git simplificado** — el usuario solo configura credenciales; el plugin gestiona el repo.

## Stack Tecnológico
| Componente        | Tecnología              |
|-------------------|-------------------------|
| Lenguaje          | TypeScript              |
| Host              | Obsidian Plugin API     |
| Bundler           | esbuild                 |
| Git               | Isomorphic-Git          |
| Auth GitHub       | Personal Access Token   |
| Auth cloud (futuro)| OAuth2 PKCE            |

## Estructura de Código (Fase 1)
```
src/
├── main.ts                    # ObSavePlugin — punto de entrada
├── settings.ts                # ObSaveSettings + configs por proveedor
├── types.ts                   # Tipos de sync y eventos UI
├── providers/
│   ├── IStorageProvider.ts    # Contrato común Fase 2
│   ├── GitHubProvider.ts      # Git / GitHub (Fase 1)
│   ├── GoogleDriveProvider.ts # Skeleton OAuth PKCE
│   ├── OneDriveProvider.ts    # Skeleton OAuth PKCE
│   └── ICloudProvider.ts      # Skeleton Fase 2
├── adapters/
│   ├── githubApi.ts           # REST GitHub (crear repo)
│   └── vaultPaths.ts          # Rutas vault y utilidades Git
├── engine/
│   └── SyncEngine.ts          # Orquestador proveedor único
└── ui/
    ├── ObSaveSettingTab.ts    # Wizard + ajustes
    └── fileDecorators.ts      # Badges de estado en Explorador
```

## Contacto y Licencia
- **Autor:** Ad Astra Forge
- **Licencia:** Open Source — 100% gratuito
