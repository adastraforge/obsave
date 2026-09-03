# ObSave — Registro de Decisiones

Formato: **ID** | Fecha | Decisión | Contexto | Alternativas descartadas

---

## DEC-001 | 2026-08-24 | OAuth2 PKCE vía navegador nativo

**Contexto:** Los conectores comerciales (Google Drive, OneDrive) requieren autenticación segura dentro del entorno Electron de Obsidian.

**Decisión:** Usar OAuth2 PKCE con redirección al navegador del sistema operativo, evitando esquemas `obsidian://` que causan ventanas colgadas o errores de callback.

**Alternativas descartadas:**
- OAuth embebido en webview de Obsidian (fragilidad de callbacks).
- API keys estáticas del usuario (mala UX y riesgo de seguridad).

---

## DEC-002 | 2026-08-24 | Esquema Master & Réplicas

**Contexto:** El usuario necesita respaldo en múltiples proveedores sin elegir uno solo como única fuente.

**Decisión:** Un repositorio **Master** como origen de verdad; **Réplicas** reciben duplicación transparente e ininterrumpida de los cambios del Master.

**Alternativas descartadas:**
- Sync bidireccional entre todos los repos (conflictos complejos, difícil de depurar).
- Solo backup unidireccional sin Master explícito (ambigüedad sobre cuál repo es autoritativo).

---

## DEC-003 | 2026-08-24 | Git simplificado con Isomorphic-Git

**Contexto:** Usuarios quieren versionado Git sin instalar Git CLI ni entender comandos.

**Decisión:** Integrar Isomorphic-Git; el usuario provee URL, usuario y token/password; el plugin gestiona `.git`, remotos `origin` y ramas internamente.

**Alternativas descartadas:**
- Requerir Git CLI instalado (barrera de entrada).
- Wrapper de shell a `git` (inconsistente entre plataformas).

---

## DEC-004 | 2026-08-24 | 100% gratuito y open source

**Contexto:** Existen plugins de sync con funciones bloqueadas tras paywall o conectores de pago.

**Decisión:** ObSave será completamente gratuito y open source, sin suscripciones, llaves pagadas ocultas ni conectores bloqueados.

**Alternativas descartadas:**
- Modelo freemium con conectores premium.
- Dependencia de servicio centralizado de Ad Astra Forge para sync.

---

## DEC-005 | 2026-08-24 | Wizard de primera sincronización simplificado

**Contexto:** Los usuarios de Obsidian no deben configurar Git manualmente ni entender remotes, ramas o CLI.

**Decisión:** Implementar un asistente de dos vías en la pestaña de ajustes:
- **1-A Repo Nuevo:** usuario + token → nombre sugerido de carpeta → creación automática en GitHub + init local.
- **1-B Repo Existente:** URL + credenciales → fusión inteligente remoto→local→push, con prompt de renombrado si los nombres difieren.

**Alternativas descartadas:**
- Formulario técnico con campos de remote/branch/ref (demasiado complejo para MVP).
- Forzar renombrado silencioso sin consentimiento del usuario.

---

## DEC-006 | 2026-08-24 | Conflictos: duplicar versión local con sufijo de fecha

**Contexto:** Al fusionar un repo existente con una bóveda local, pueden existir archivos con el mismo path pero contenido distinto.

**Decisión:** Aplicar estrategia conservadora: conservar la versión remota en el path original y duplicar la versión local con el sufijo `(Copia de conflicto local YYYY-MM-DD)` antes del push.

**Alternativas descartadas:**
- Sobrescribir local sin aviso (pérdida de datos).
- Abortar sync completo ante cualquier conflicto (mala UX).
- Merge interactivo tipo Git CLI (fuera del espíritu "simplificado").

---

## DEC-007 | 2026-08-24 | Pipeline de release automático Obsidian

**Contexto:** ObSave requiere publicar versiones reproducibles para BRAT y usuarios finales, con artefactos `main.js` + `manifest.json` verificados.

**Decisión:** Establecer regla de **Release Automático de Obsidian** en `.cursorrules` e `ia-ops.md`:
1. Build gate (`npm run build` exit 0).
2. Sincronizar versión en `manifest.json` y `package.json`.
3. Publicar vía `gh release create` o, si no hay `gh CLI`, workflow `.github/workflows/release.yml` disparado por tags `v*`.

**Release oficial:** `v1.0.0` — Fase 1 MVP Git Core listo para BRAT.

**Alternativas descartadas:**
- Releases manuales sin CI (propenso a olvidar artefactos o versiones desincronizadas).
- Solo commit de código sin GitHub Release (BRAT funciona, pero sin trazabilidad de versiones).

---

## DEC-008 | 2026-08-24 | Auto-sync al iniciar + slider de intervalo 1–15 min

**Contexto:** Los usuarios esperan respaldo transparente sin configurar timers manualmente ni recordar sincronizar al abrir Obsidian.

**Decisión:**
- Ejecutar `triggerSync()` automáticamente en `onload()` — sin toggle en ajustes (comportamiento fijo).
- Reemplazar input numérico por slider Obsidian (`addSlider`) con rango 1–15 minutos.
- `setInterval` en `main.ts` reinicia al cambiar el slider vía `saveSettings()`.

**Release:** `v1.0.1`

**Alternativas descartadas:**
- Toggle para desactivar sync al iniciar (complejidad innecesaria en Fase 1).
- Rango >15 min (fuera del alcance solicitado para MVP).

---

## DEC-009 | 2026-08-24 | Renombrado de bóveda vía FileSystemAdapter

**Contexto:** El wizard PASO 1-A renombraba la carpeta con `fs` directo y Git operaba sobre rutas obsoletas del adapter cacheado.

**Decisión:** `renameVaultFolder()` usa `FileSystemAdapter.getBasePath()` como gateway, valida con `adapter.exists("")`, renombra el directorio hermano y retorna la ruta absoluta nueva; `GitAdapter` usa esa ruta directamente.

**Alternativas descartadas:**
- Recalcular ruta con `path.join(dirname(getBasePath()), name)` sin usar el retorno del rename (frágil post-rename).

---

## DEC-010 | 2026-08-24 | UI v1.0.2: badge de versión y desconexión segura

**Contexto:** Los testers BRAT necesitan identificar la versión activa y poder reiniciar la configuración sin reinstalar el plugin.

**Decisión:**
- Mostrar `this.plugin.manifest.version` en la cabecera de ajustes.
- Sección "Gestión de Conexión" con botón `mod-warning` que limpia Master/credenciales, sanitiza `origin` en `.git` y recarga el wizard.

**Release:** `v1.0.2`

**Alternativas descartadas:**
- Borrar `.git` al desconectar (destructivo; el usuario podría querer conservar historial local).
- Confirmación modal extra (MVP: acción directa con notice).

---

## DEC-011 | 2026-08-24 | Sin renombrado físico de bóveda + persistencia data.json

**Contexto:** Renombrar la carpeta del vault en caliente rompe la referencia de Obsidian a `data.json` y resetea la configuración al actualizar el plugin.

**Decisión:**
- Eliminar renombrado físico del vault; actualizar solo `masterRepo.label` y metadatos internos.
- `mergeStoredSettings()` carga `data.json` preservando `masterRepo` y credenciales sin sobrescribir con defaults.

**Release:** `v1.0.3`

**Alternativas descartadas:**
- Renombrar carpeta y pedir reabrir bóveda (UX frágil, pierde contexto del plugin).

---

## DEC-012 | 2026-08-24 | Reconciliación Git antes de push

**Contexto:** Push inicial fallaba con error non-fast-forward cuando el remoto tenía commits previos.

**Decisión:** En `GitAdapter`, ejecutar `fetch` + `merge` de `origin/main` antes de cada `push`; reintentar integración si el push es rechazado.

**Release:** `v1.0.3`

**Alternativas descartadas:**
- `git push --force` (riesgo de sobrescribir historial remoto).

---

## DEC-013 | 2026-08-24 | Pipeline Git performSync de 3 pasos

**Contexto:** SyncEngine era stub; los usuarios no veían cambios reales reflejados entre bóveda y GitHub.

**Decisión:** Implementar `GitAdapter.performSync()` con ciclo estricto:
- **A:** `statusMatrix` → add/remove → commit local (`sync: auto-commit local [timestamp]`).
- **B:** fetch → merge `origin/main` → `checkout({ force: true })` al working directory.
- **C:** push si HEAD local adelantado.
- Fast-path si 0 cambios y hashes idénticos (~0.5s).
- Excluir `.obsidian/` del escaneo.

**Release:** `v1.0.4`

**Alternativas descartadas:**
- Seguir con stub + mensaje genérico (sin valor para el usuario).

---

## DEC-014 | 2026-08-24 | Pipeline remoto-first + conflictos [Local]/[Sync]

**Contexto:** El orden local→remoto causaba rechazos de push; los conflictos en `.md` perdían contenido del usuario.

**Decisión:**
1. Reordenar `performSync()`: fetch → merge/checkout remoto → commit local → push.
2. **Conflict Fallback** en `.md`: duplicar como `[Local] archivo.md` (copia local) y `[Sync] archivo.md` (versión remota), con notice explícito al usuario.
3. Formato de `lastSyncAt` en UI: `YYYY-MM-DD HH:mm:ss` zona horaria local.

**Release:** `v1.0.5`

**Alternativas descartadas:**
- Sobrescribir local con remoto en conflictos (pérdida de datos).
- Mantener sufijo `(Copia de conflicto local YYYY-MM-DD)` en sync periódico (reemplazado por [Local]/[Sync] en performSync).

---

## DEC-015 | 2026-08-24 | Last-Write-Wins — eliminación de duplicados

**Contexto:** Los prefijos `[Local]`/`[Sync]` duplicaban archivos en la bóveda y el push seguía fallando por fast-forward en escenarios divergentes.

**Decisión:**
1. Eliminar toda lógica de duplicación (`[Local]`, `[Sync]`, copias con sufijo de fecha en `performSync`).
2. Adoptar **Last-Write-Wins**: comparar timestamp del commit remoto vs `mtime` local; escribir solo en la ruta original.
3. `git.merge({ fastForwardOnly: false })` + `checkout({ force: true })`; push con reintento `fetch` + `merge` ante `PushRejected`.

**Release:** `v1.0.6`

**Alternativas descartadas:**
- Duplicar archivos en conflictos (saturaba la bóveda y confundía al usuario).
- `git push --force` (destructivo para el remoto compartido).

---

## DEC-016 | 2026-08-24 | Decoradores visuales + sync automático silencioso

**Contexto:** Las notificaciones en cada sync automática interrumpían al usuario; faltaba feedback visual del estado Git por archivo en la bóveda.

**Decisión:**
1. **`ObSaveFileDecorators`:** inyección CSS (`.obsave-status-new|modified|synced`) en el Explorador de Archivos vía `getLeavesOfType("file-explorer")`; estados derivados de `statusMatrix` + comparación HEAD local vs remoto.
2. **Notificaciones:** `SyncTrigger` (`manual` | `automatic`); `Notice` solo en sync manual o error; automático registra en consola y refresca badges.
3. **`GitAdapter.getMarkdownFileStatuses()`:** API pública para mapear rutas `.md` → estado visual.

**Release:** `v1.0.7`

**Alternativas descartadas:**
- Mostrar notice en auto-sync con cambios (ruidoso en intervalos cortos).
- Panel lateral separado para estado de archivos (más invasivo que decoradores nativos).

---

## DEC-017 | 2026-08-24 | Decoradores span + styles.css en release

**Contexto:** Los pseudo-elementos `::before` inyectados por JS no renderizaban de forma fiable en el Explorador; faltaba `styles.css` como artefacto de distribución.

**Decisión:**
1. Reemplazar clases en título por `<span class="obsave-dot obsave-dot-{status}">` anclado a `.nav-file-title[data-path]` o `.nav-file[data-path]`.
2. **`styles.css`** en raíz del plugin (Obsidian lo carga automáticamente); workflow release adjunta `main.js`, `manifest.json` y `styles.css`.
3. Eventos de refresco registrados en `main.ts`: `layout-change`, `vault.modify` (diferido) e inmediato post-`performSync`.

**Release:** `v1.0.8`

**Alternativas descartadas:**
- Mantener CSS inline en `<style>` (no distribuible vía BRAT sin archivo dedicado).
- Solo `::before` en `.nav-file-title` (selectores inconsistentes entre versiones de Obsidian).

---

## DEC-018 | 2026-08-24 | Arquitectura de Proveedor Único Simplificado

**Contexto:** El modelo Master-Réplicas añadía complejidad prematura; la Fase 2 requiere conectores OAuth independientes con un contrato unificado.

**Decisión:**
1. Eliminar `masterRepo`, `replicaRepos` y roles espejo de settings; adoptar `activeProvider` + `providerConfig`.
2. Introducir **`IStorageProvider`** (`connect`, `sync`, `disconnect`) y registrar GitHub, Google Drive, OneDrive, iCloud.
3. Migrar `GitAdapter` → **`GitHubProvider`**; skeletons para conectores OAuth Fase 2.
4. `SyncEngine` delega al proveedor activo del registro.

**Alternativas descartadas:**
- Mantener réplicas espejo en Fase 1 (sin implementación real, confusión de UX).
- Un adapter monolítico sin interfaz común (bloquea Fase 2 OAuth).

---

## DEC-019 | 2026-08-24 | Wizard con selección de proveedor de nube

**Contexto:** Tras la arquitectura de proveedor único, el asistente seguía asumiendo GitHub como única opción visible, sin preparar la UX para conectores Fase 2.

**Decisión:**
1. Primer paso del wizard: grid de 4 proveedores (`activeProvider`); GitHub activo, resto con badge «Próximamente».
2. Flujo GitHub: selección → bóveda nueva/existente → formulario PAT (sin cambios funcionales).
3. Botón «← Volver a selección de proveedor» en todas las pantallas de configuración GitHub.
4. Estilos en `styles.css` (`.obsave-provider-grid`, `.obsave-provider-card`, badges).

**Release:** `v1.0.10`

**Alternativas descartadas:**
- Dropdown nativo de Obsidian (menos descubrible que tarjetas).
- Habilitar skeletons OAuth como clicables (generaría errores de sync).

---

## DEC-020 | 2026-08-24 | Badges limpios en selector de proveedores

**Contexto:** Los badges «Activo» en tarjetas no configuradas generaban ruido visual; Google Drive debe abrir el wizard OAuth sin etiqueta «Próximamente».

**Decisión:**
1. Regla de badges: **Conectado** solo con credenciales almacenadas; sin badge en tarjetas limpias; **Próximamente** solo en OneDrive/iCloud.
2. Clase CSS `.is-connected` reemplaza `.is-active`.
3. Google Drive seleccionable → modo wizard `gdrive-setup` (placeholder OAuth Fase 2).
4. Helper `hasProviderCredentials()` en `settings.ts`.

**Release:** `v1.0.11`

**Alternativas descartadas:**
- Badge «Disponible» en GitHub sin configurar (redundante con interactividad de la tarjeta).

---

## DEC-021 | 2026-08-24 | Integración OAuth2 PKCE Google Drive

**Contexto:** Google Drive requiere autenticación OAuth2 segura en desktop Obsidian (Electron), alineada con la premisa PKCE + navegador nativo.

**Decisión:**
1. Módulos `src/oauth/`: PKCE (Crypto API), `localCallbackServer` (127.0.0.1:42000), constantes Google.
2. **`GoogleDriveProvider`:** `getAuthUrl()` / `authenticateWithPkce()`, intercambio de tokens, `refresh_token` con renovación programada.
3. Wizard: botón «Conectar con Google Drive»; persistencia de email/nombre y `activeProvider = 'gdrive'`.
4. Client ID vía `OBSAVE_GOOGLE_CLIENT_ID` en build (esbuild `define`).

**Release:** `v1.0.12`

**Alternativas descartadas:**
- Esquema `obsidian://` como callback principal (fragilidad documentada en DEC-001).
- Client secret embebido (innecesario en PKCE desktop).

---

## DEC-022 | 2026-08-24 | Fix "Failed to load plugin" — require diferido

**Contexto:** Tras v1.0.12, Obsidian fallaba al cargar el plugin por `import`/`require` estático de `http` y `electron` en el ámbito superior del bundle OAuth.

**Decisión:**
1. **`runtimeBridge.ts`:** carga diferida de `http` (callback OAuth) y `electron.shell` con fallback `window.open`.
2. Eliminar `import * as http from "http"` en `localCallbackServer.ts`.
3. `main.ts`: `try-catch` en registro de listener y `connect()` de Google Drive para aislar errores secundarios.

**Release:** `v1.0.13`

**Alternativas descartadas:**
- Import estático de Node builtins en módulos OAuth (rompe carga en runtime Obsidian).

---

## DEC-023 | 2026-09-02 | Fix fatal load v1.0.14 — lazy GDrive + esbuild browser

**Contexto:** v1.0.13 seguía provocando "Failed to load plugin" por evaluación temprana del grafo OAuth/Node al cargar `main.js`.

**Decisión:**
1. **`GoogleDriveLazyProvider`:** proxy `IStorageProvider` con `import()` diferido; sin export barrel de `GoogleDriveProvider`.
2. **`esbuild.config.mjs`:** `platform: 'browser'`, lista explícita de externos Node; producción vía `esbuild.build()`.
3. **`main.ts`:** solo UI/config en `onload`; GDrive via `setPendingConfig` hasta sync o botón OAuth.
4. OAuth: `window.require('http')` exclusivamente al iniciar callback; try/catch en toda la cadena.

**Release:** `v1.0.14`

**Alternativas descartadas:**
- `inlineDynamicImports` con `format: cjs` (no soportado en esbuild 0.21).
- Init de `GoogleDriveProvider` en `onload` aunque falle silenciosamente.

---

## DEC-024 | 2026-09-02 | Client ID Google OAuth en CI de release

**Contexto:** Los builds de release en GitHub Actions no incluían `OBSAVE_GOOGLE_CLIENT_ID`, dejando el OAuth de Google Drive sin client ID embebido en artefactos publicados.

**Decisión:**
1. Paso `Build plugin` en `.github/workflows/release.yml` expone `OBSAVE_GOOGLE_CLIENT_ID` desde `secrets.OBSAVE_GOOGLE_CLIENT_ID`.
2. Esbuild ya define `__OBSAVE_GOOGLE_CLIENT_ID__` vía `process.env.OBSAVE_GOOGLE_CLIENT_ID` en `esbuild.config.mjs`.

**Release:** `v1.0.15`

**Alternativas descartadas:**
- Hardcodear Client ID en el repo (expone credencial pública innecesariamente en fuente).
- Script post-build manual fuera del workflow (propenso a olvidos).

---

## DEC-025 | 2026-09-02 | Documentación legal y README público

**Contexto:** ObSave requiere políticas de privacidad y términos visibles para usuarios y cumplimiento OAuth Google; el repo carecía de README y documentos legales.

**Decisión:**
1. **`PRIVACY.md`:** sin recolección Ad Astra Forge; scope `drive.file`; tokens locales Obsidian; contacto soporte.
2. **`TERMS.md`:** MIT; disclaimer pérdida datos sync; uso APIs sujeto a términos GitHub/Google.
3. **`README.md`:** badges, instalación, config GDrive con explicación privacidad, enlaces a políticas.

**Release:** `v1.0.16`

---

## DEC-026 | 2026-09-02 | Callback OAuth HTML y resolución de promesa

**Contexto:** Tras autorizar en Google, la ventana de callback no cerraba correctamente y la UI permanecía en estado «Esperando autorización» si la promesa se resolvía antes de completar la respuesta HTTP.

**Decisión:**
1. **`localCallbackServer`:** HTML visual con `window.open('', '_self', ''); window.close();`; `finish()` en callback de `res.end()`.
2. **`GoogleDriveProvider`:** intercambio de tokens con try/catch; `persistConfig` dispara `saveSettings` vía listener.
3. **`ObSaveSettingTab`:** «Conectando…» / «Cuenta de Google Conectada (email)»; Notice genérico en error.

**Release:** `v1.0.17`

---

## DEC-027 | 2026-09-02 | Persistencia OAuth y auto-cierre diferido

**Contexto:** Tras autorizar en Google, el estado conectado no siempre se reflejaba en la UI y la pestaña del navegador no cerraba de forma fiable.

**Decisión:**
1. Guardado explícito en `ObSaveSettingTab` con `enabled: true` y `saveSettings()`.
2. HTML de callback con `setTimeout(window.close, 1000)`; `server.close()` diferido 1.5 s.
3. Logs `[ObSave OAuth]` en callback, intercambio de tokens y guardado.

**Release:** `v1.0.18`

---

## DEC-028 | 2026-09-02 | Logging exhaustivo OAuth Google Drive

**Contexto:** Depurar fallos silenciosos en el flujo OAuth requiere trazas visibles en consola Obsidian y notices en UI.

**Decisión:**
1. UI: `[ObSave UI] Botón Conectar Clickeado`, Notice inicial, catch con `[ObSave UI Error]` y mensaje detallado.
2. Provider: logs PKCE, URL, puerto 42000, solicitud de tokens y cuerpo de error Google.
3. Post-éxito: log guardado settings + `display()` obligatorio.

**Release:** `v1.0.20`

---

## DEC-029 | 2026-09-02 | Fix EADDRINUSE puerto 42000 OAuth

**Contexto:** Reintentos OAuth fallaban con `EADDRINUSE` porque instancias previas del servidor callback no liberaban el puerto 42000.

**Decisión:**
1. Referencia global `activeServer` + `stopServer()` antes de cada `listen`.
2. Retry automático en `EADDRINUSE` (300 ms, hasta 3 intentos).
3. Cierre diferido 500 ms tras callback exitoso; timeout global 120 s.

**Release:** `v1.0.21`

---

## DEC-030 | 2026-09-02 | Token exchange Google y cierre inmediato puerto 42000

**Contexto:** Errores de Google OAuth no eran visibles al usuario; el puerto 42000 debía liberarse al instante tras el callback.

**Decisión:**
1. `stopServer()` con `close()` + `unref()`; cierre inmediato tras HTML de éxito (sin delay).
2. `exchangeCodeForTokens`: POST con parámetros PKCE; Notice con `error_description` de Google.
3. `GoogleDriveAuthContext.onAuthSuccess`: guarda `providerConfig.gdrive`, Notice éxito y `display()`.

**Release:** `v1.0.22`

---

## DEC-031 | 2026-09-02 | Body PKCE desktop sin client_secret

**Contexto:** Clientes OAuth desktop PKCE no deben enviar `client_secret` al token endpoint; el payload debe ser estrictamente de 5 campos.

**Decisión:**
1. `buildDesktopPkceTokenBody()` construye Form Data con solo `client_id`, `code`, `grant_type`, `redirect_uri`, `code_verifier`.
2. Log explícito de campos enviados; guardado explícito de tokens en `providerConfig.gdrive.enabled`.

**Release:** `v1.0.23`

---

## DEC-032 | 2026-09-02 | Inyección OBSAVE_GOOGLE_CLIENT_SECRET en build

**Contexto:** Google OAuth token endpoint requiere `client_secret` para el tipo de cliente configurado en Cloud Console.

**Decisión:**
1. `esbuild.config.mjs` define `__OBSAVE_GOOGLE_CLIENT_SECRET__` desde env de build.
2. `.github/workflows/release.yml` expone secret en paso `npm run build`.
3. `exchangeCodeForTokens` y refresh incluyen `client_secret` en URLSearchParams.

**Release:** `v1.0.24`

**Nota:** El secret queda embebido en `main.js` del release — aceptable solo para clientes confidenciales distribuidos vía CI privada.

---

## DEC-033 | 2026-09-02 | Validación credenciales y errores OAuth detallados

**Contexto:** Fallos por secrets ausentes en CI o errores opacos del token endpoint de Google.

**Decisión:**
1. `requireGoogleCredentials()` antes de auth y token POST.
2. Parse JSON de error Google → `Google OAuth [status]: detail`.
3. `authenticateWithPkce` catch global con `Notice("Error en OAuth: " + message)`.

**Release:** `v1.0.25`

---

## DEC-034 | 2026-09-02 | Scopes email/profile y userinfo defensivo

**Contexto:** userinfo fallaba con 401/403 por scope insuficiente y abortaba el flujo OAuth tras tokens válidos.

**Decisión:**
1. Scope ampliado: `drive.file email profile`.
2. `fetchUserProfile` retorna perfil por defecto si userinfo no es 200.
3. `accountEmail` persistido en `providerConfig.gdrive` cuando userinfo OK.

**Release:** `v1.0.26`

---

## DEC-035 | 2026-09-02 | Rediseño UI/UX panel de ajustes

**Contexto:** La vista de settings era técnica, con notices molestas y navegación confusa entre wizard y estado conectado.

**Decisión:**
1. Dashboard con secciones General y Sincronización; footer `ObSave vX by Ad Astra Forge`.
2. Routing: conectado → panel; picker con badges; Cambiar proveedor sin desconectar.
3. SyncEngine/main: sin Notice ni intervalo si no hay proveedor activo.

**Release:** `v1.0.27`

---

## DEC-036 | 2026-09-03 | Arquitectura 3 vistas en ajustes

**Contexto:** Navegación fragmentada (wizard modes) y flujos GitHub en pantallas separadas.

**Decisión:**
1. Vistas estrictas: Home (selector), Asistente (conexión), Dashboard (sync).
2. Routing: conectado → dashboard; sin configurar → asistente.
3. GitHub unificado con dropdown nuevo/existente; bloqueo si otro proveedor activo.

**Release:** `v1.0.28`

---

## DEC-037 | 2026-09-03 | Google Drive — carpetas, modal y sync de notas

**Contexto:** Tras OAuth, faltaba elegir/crear carpeta destino y subir archivos `.md` a Drive.

**Decisión:**
1. Settings `folderMode`, `folderName`, `folderSelected`, `folderPath`, `folderId`.
2. Modal visual de carpetas; bloque de ubicación en dashboard con abrir/copiar/cambiar.
3. `GoogleDriveProvider`: `getOrCreateTargetFolder`, `listFiles`, `uploadFile`.
4. `SyncEngine` lee `.md` de la bóveda y sube vía provider; landing OAuth dark mode.

**Release:** `v1.0.29`

---

## DEC-038 | 2026-09-03 | Callback, scope drive, badges y auto-sync

**Contexto:** Callback con botón redundante; scope `drive.file` limitaba carpetas; faltaban badges GDrive y toggle auto-sync.

**Decisión:**
1. Landing éxito: autocierre + mensaje manual sin botón si el navegador bloquea `close()`.
2. Scope `https://www.googleapis.com/auth/drive`; paginación en `listFolders`.
3. `FileStatusDecorator` unificado; `syncedFileMtimes` para GDrive; `autoSyncEnabled` en settings.

**Release:** `v1.0.30`

---
