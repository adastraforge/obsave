# Documentación ObSave — Auditorías y planes

Índice de informes técnicos del plugin **ObSave** (Ad Astra Forge).

| Documento | Versión | Fecha | Descripción |
|-----------|---------|-------|-------------|
| [auditoria-obsave-v1.0.35.md](./auditoria-obsave-v1.0.35.md) | v1.0.35 | 2026-09-04 | OAuth, motor sync, auto-sync, rendimiento |
| [auditoria-obsave-v1.0.35.pdf](./auditoria-obsave-v1.0.35.pdf) | v1.0.35 | 2026-09-04 | Export PDF del informe anterior |
| [auditoria-obsave-v1.0.38.md](./auditoria-obsave-v1.0.38.md) · [PDF](./auditoria-obsave-v1.0.38.pdf) | v1.0.38 | 2026-09-07 | Notas eliminadas, generador carpetas, atajos |
| [plan-correccion-obsave-v1.0.38.md](./plan-correccion-obsave-v1.0.38.md) · [PDF](./plan-correccion-obsave-v1.0.38.pdf) | v1.0.38 | 2026-09-07 | Plan de implementación P0–P3 (pendiente) |

## Generar PDF (opcional)

Si tienes [Pandoc](https://pandoc.org/) instalado:

```bash
pandoc docs/auditoria-obsave-v1.0.38.md \
  -o docs/auditoria-obsave-v1.0.38.pdf \
  --pdf-engine=xelatex \
  -V geometry:margin=2.5cm \
  -V lang=es
```

Alternativa: exportar desde Obsidian, VS Code o cualquier visor Markdown con impresión a PDF.
