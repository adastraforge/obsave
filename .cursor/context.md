# ObSave — Contexto del Proyecto

## Marca y Visión
**Ad Astra Forge** desarrolla **ObSave**, un plugin open-source y gratuito para Obsidian orientado a la sincronización multi-repositorio y auto-respaldo **sin intermediarios comerciales**.

El usuario mantiene control total de sus datos: el vault se replica de forma transparente entre un repositorio **Master** y múltiples **Réplicas** (Google Drive, OneDrive, GitHub, iCloud, S3, etc.).

## Fase Actual: Fase 1 — MVP Git Core Simplificado

### Objetivo de la Fase 1
Establecer el núcleo del plugin con:
- Configuración persistente (`ObSaveSettings`)
- UI mínima (pestaña de ajustes + icono de ribbon con estado)
- Stub del motor de sincronización Master-Réplicas
- Pipeline de build TypeScript → esbuild → `main.js`

### Fuera de Alcance (Fases Posteriores)
- Conectores OAuth2 PKCE completos (Fase 2)
- Réplicas automáticas en la nube (Fase 3)
- Git simplificado con Isomorphic-Git (Fase 4)

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
| Git (futuro)      | Isomorphic-Git          |
| Auth (futuro)     | OAuth2 PKCE             |

## Estructura de Código (Fase 1)
```
src/
├── main.ts              # ObSavePlugin — punto de entrada
├── types.ts             # Interfaces compartidas
├── engine/
│   └── SyncEngine.ts    # Motor Master-Réplicas (stub)
└── ui/
    └── ObSaveSettingTab.ts
```

## Contacto y Licencia
- **Autor:** Ad Astra Forge
- **Licencia:** Open Source — 100% gratuito
