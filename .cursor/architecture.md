# ObSave — Arquitectura

## Diagrama de Capas

```mermaid
flowchart TB
    subgraph UI["Capa UI"]
        ST[SettingTab]
        HV[ObSave Hub / ItemView]
        CM[CaptureNoteModal]
        RI[Ribbon layout-dashboard]
    end

    subgraph Prod["Capa productividad local"]
        NC[noteCapture]
        VS[vaultStructure]
        RD[VaultReportDashboard]
        NR[noteTypeRename]
    end

    subgraph Vault["Obsidian Vault API"]
        VA[vault.create / createFolder]
        MC[metadataCache]
        WS[workspace]
    end

    ST --> VS
    ST --> NC
    ST --> HV
    HV --> NC
    HV --> CM
    HV --> RD
    CM --> NC
    RI --> HV
    NC --> VA
    VS --> VA
    RD --> MC
    RD --> WS
    NR --> VA
```

## Definición de Capas

### 1. UI (Presentación)
- **Responsabilidad:** Ajustes, Hub lateral, modal de nueva nota y ribbon.
- **Componentes:** `ObSaveSettingTab`, `ObSaveSidebarView`, `CaptureNoteModal`, `VaultReportDashboard`.
- **Regla:** No hay motor de red ni estado de sync; las acciones delegan a la capa de productividad.

### 2. Productividad local (Dominio)
- **Responsabilidad:** Crear estructura de carpetas, notas rápidas/nuevas y métricas de la bóveda.
- **Contratos:** `generateVaultTemplateFolders(app)`, `createQuickDailyNote(app)`, `createCaptureNote(app, options)`, `computeVaultMetrics` vía `metadataCache`.
- **Regla:** Solo el sistema de archivos nativo de Obsidian. Cero HTTP, OAuth o manifiestos remotos.

### 3. Capa retirada (v2.0.0)
Hasta v1.2.3 existían `SyncEngine`, `StorageAdapters`, `OAuthHandler` y `LedgerManager`. Se eliminaron por completo: no hay proveedores, tokens ni temporizadores de auto-sync.

## Comandos activos

1. `open-obsave-panel` — Abrir panel principal de ObSave
2. `obsave-hub` — Abrir ObSave Hub lateral
3. `obsave-quick-note` — Crear nota rápida ObSave
4. `obsave-capture-note` — Crear nueva nota ObSave

## Persistencia

v2.0.0 no guarda ajustes de sync. Al cargar, se vacía `data.json` legado (tokens, `providerConfig`, ledger embebido) y se intentan borrar `ledger.json` / `.bak` / `.tmp` del directorio del plugin.
