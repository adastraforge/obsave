# ObSave — Contexto del Proyecto

## Marca y Visión
**Ad Astra Forge** desarrolla **ObSave**, un plugin open-source y gratuito para Obsidian orientado a la sincronización multi-repositorio y auto-respaldo **sin intermediarios comerciales**.

El usuario mantiene control total de sus datos: el vault se replica de forma transparente entre un repositorio **Master** y múltiples **Réplicas** (Google Drive, OneDrive, GitHub, iCloud, S3, etc.).

## Fase Actual: Fase 1 — MVP Git Core Simplificado

> **Estado de release:** Fase 1 **publicada oficialmente** — `v1.0.3`  
> GitHub Release: `https://github.com/adastraforge/obsave/releases/tag/v1.0.3`  
> BRAT: `https://github.com/adastraforge/obsave` — artefactos: `manifest.json` + `main.js`  
> Pipeline: `.github/workflows/release.yml` (trigger: push tag `v*`)

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
3. **Master & Réplicas** — un origen de verdad y espejos automáticos.
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
├── types.ts                   # Interfaces compartidas
├── adapters/
│   ├── GitAdapter.ts          # Git simplificado + wizard backend
│   ├── githubApi.ts           # REST GitHub (crear repo)
│   └── vaultPaths.ts          # Rutas, renombrado, conflictos
├── engine/
│   └── SyncEngine.ts          # Motor Master-Réplicas (stub)
└── ui/
    └── ObSaveSettingTab.ts    # Wizard + ajustes
```

## Contacto y Licencia
- **Autor:** Ad Astra Forge
- **Licencia:** Open Source — 100% gratuito
