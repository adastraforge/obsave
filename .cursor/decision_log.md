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
