# Ad Astra Forge — Estándares de Operaciones IA

## Principios Generales
1. **Build Gate:** Siempre ejecutar `npm run build` antes de commit/push.
2. **Documentación viva:** Actualizar `context.md`, `architecture.md` y `decision_log.md` tras cambios estructurales.
3. **Scope mínimo:** Cambios focalizados; no refactorizar código no relacionado.
4. **Convenciones del repo:** Leer código circundante antes de escribir.

## Flujo de Trabajo del Agente

```
1. Leer contexto (.cursor/context.md, architecture.md)
2. Implementar cambio mínimo necesario
3. npm run build → reparar si falla
4. Actualizar docs si cambió arquitectura
5. Solo entonces sugerir commit (si el usuario lo pide)
```

## Estándares TypeScript
- Modo estricto habilitado en `tsconfig.json`.
- Interfaces centralizadas en `src/types.ts`.
- Clases de dominio en `src/engine/`.
- UI en `src/ui/`.
- Sin `any` salvo integración con APIs externas no tipadas.

## Estándares Obsidian Plugin
- Entry point: `src/main.ts` → bundle `main.js`.
- Settings con `loadData` / `saveData`.
- Ribbon icons con `setIcon` de lucide/obsidian.
- Notices para feedback al usuario (`new Notice(...)`).

## Commits
- Mensajes en español, enfocados en el **porqué**.
- Formato: `<tipo>: <descripción breve>` (feat, fix, docs, refactor, chore).
- No commitear `node_modules/`, `main.js`, secretos ni `.env`.

## Seguridad
- Nunca hardcodear tokens, API keys ni credenciales.
- OAuth tokens solo en storage cifrado del plugin (futuro).
- No loguear credenciales en consola.

## Testing (Futuro)
- Tests unitarios para SyncEngine y adapters.
- Validación manual en Obsidian Desktop antes de release.

## Releases (Futuro)
- Versionado semver en `manifest.json` y `versions.json`.
- Changelog por fase en releases de GitHub.
