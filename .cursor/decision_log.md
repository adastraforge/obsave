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
