# ObSave — Roadmap por Fases

## Fase 1: MVP Git Core Simplificado ✅ (En curso)

**Objetivo:** Plugin funcional mínimo con arquitectura base y build pipeline.

| Entregable | Estado |
|------------|--------|
| Estructura `.cursor/` y gobernanza | ✅ |
| `manifest.json`, `tsconfig`, esbuild | ✅ |
| `ObSavePlugin` + SettingTab + ribbon | ✅ |
| `SyncEngine` stub | ✅ |
| `npm run build` exitoso | ✅ |

**Criterio de salida:** Plugin carga en Obsidian, muestra ajustes y ribbon; build pasa sin errores.

---

## Fase 2: OAuth2 PKCE y Conectores Base

**Objetivo:** Autenticación directa con Google Drive y OneDrive.

| Entregable | Descripción |
|------------|-------------|
| `OAuthHandler` | Flujo PKCE con navegador nativo |
| `GoogleDriveAdapter` | Lectura/escritura básica en Drive |
| `OneDriveAdapter` | Lectura/escritura básica en OneDrive |
| Token store | Persistencia y refresh de tokens |
| UI de conexión | Botones "Conectar" por proveedor en Settings |

**Criterio de salida:** Usuario conecta Drive u OneDrive desde Obsidian sin errores de callback.

---

## Fase 3: Sincronización Master-Réplicas

**Objetivo:** Motor de sync operativo con estrategia Master → Réplicas.

| Entregable | Descripción |
|------------|-------------|
| `SyncEngine` completo | Detección de cambios, cola, reintentos |
| Config Master/Réplica | UI para asignar roles por repo |
| Réplicas automáticas | Push transparente post-sync Master |
| Estado en ribbon | idle / syncing / error con tooltip |
| Intervalo configurable | Sync periódico en background |

**Criterio de salida:** Cambio en vault se propaga al Master y a al menos una Réplica configurada.

---

## Fase 4: Git Simplificado Nativo

**Objetivo:** Versionado Git sin CLI, integrado al flujo de sync.

| Entregable | Descripción |
|------------|-------------|
| Isomorphic-Git integration | Init, commit, push, pull internos |
| `GitHubAdapter` | Remote GitHub vía HTTPS + token |
| UI simplificada | Solo URL, usuario, token |
| Branch management | Rama por defecto configurable |
| Historial básico | Últimos commits visibles en Settings |

**Criterio de salida:** Usuario configura repo GitHub con URL + token; plugin hace commit y push automático tras sync.

---

## Visión Post-Fase 4 (Backlog)
- Adaptador S3 / compatible
- Adaptador iCloud (donde la plataforma lo permita)
- Resolución de conflictos con UI
- Sync selectivo por carpeta
- Modo offline con cola diferida
