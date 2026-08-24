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

## Release Automático de Obsidian

Cuando el usuario solicite un **release** o **versión de producción**:

```
1. npm run build          → exit code 0 obligatorio
2. Sincronizar versión    → manifest.json + package.json (misma semver)
3. git add -f main.js manifest.json (+ cambios de docs/reglas)
4. Publicar release:
   a) Preferido: gh release create <tag> main.js manifest.json \
        --title '<titulo>' --notes '<notas>'
   b) Fallback: git tag -a <tag> -m '<titulo>' && git push origin <tag>
      → dispara .github/workflows/release.yml
5. Actualizar context.md + decision_log.md
6. git commit + git push (si quedan cambios pendientes)
```

### Convenciones de versión
- Tag Git: `vX.Y.Z` (ej. `v1.0.0`)
- `manifest.json` → campo `version`: `X.Y.Z` (sin prefijo `v`)
- `package.json` → campo `version`: debe coincidir con `manifest.json`

### Artefactos de release
| Archivo | Obligatorio | Notas |
|---------|-------------|-------|
| `main.js` | Sí | Bundle esbuild; incluir en repo y en release |
| `manifest.json` | Sí | Metadatos del plugin Obsidian |

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
- Formato: `<tipo>: <descripción breve>` (feat, fix, docs, refactor, chore, build, release).
- No commitear `node_modules/`, secretos ni `.env`.
- `main.js` se commitea en commits de **release** (`git add -f main.js`).

## Seguridad
- Nunca hardcodear tokens, API keys ni credenciales.
- OAuth tokens solo en storage cifrado del plugin (futuro).
- No loguear credenciales en consola.

## Testing (Futuro)
- Tests unitarios para SyncEngine y adapters.
- Validación manual en Obsidian Desktop antes de release.

## Releases
- Versionado semver en `manifest.json` y `package.json`.
- CI/CD: `.github/workflows/release.yml` (trigger: push tag `v*`).
- Changelog en notas del GitHub Release.
- Distribución beta: BRAT apunta a `https://github.com/adastraforge/obsave`.
