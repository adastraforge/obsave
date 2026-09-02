# Política de Privacidad — ObSave

**Última actualización:** 2 de septiembre de 2026  
**Editor:** Ad Astra Forge  
**Producto:** ObSave — plugin de Obsidian para sincronización multi-proveedor

---

## Resumen

ObSave está diseñado con **privacidad local y transparencia** como principios fundamentales. El plugin opera en tu dispositivo y se comunica **directamente** con el proveedor de nube que elijas (GitHub, Google Drive u otros). **Ad Astra Forge no opera servidores intermediarios** ni recibe datos de tu bóveda.

## Qué datos recopila ObSave

ObSave **no recopila, vende, alquila ni transmite** datos personales ni contenido de tu bóveda a servidores de Ad Astra Forge ni a terceros con fines comerciales o analíticos.

La información que el plugin utiliza permanece bajo tu control:

| Dato | Dónde se guarda | Propósito |
|------|-----------------|-----------|
| Tokens OAuth2 (Google Drive) | Configuración local de Obsidian en tu dispositivo | Autenticación con Google Drive |
| Personal Access Token (GitHub) | Configuración local de Obsidian en tu dispositivo | Sincronización con repositorios Git |
| URL de repositorio, email/nombre de perfil | Configuración local de Obsidian | Identificar la cuenta conectada |
| Contenido de la bóveda | Tu dispositivo y el proveedor de nube elegido | Sincronización y respaldo |

## Google Drive — alcance restringido

La autenticación con Google Drive utiliza OAuth 2.0 con PKCE y el scope restringido:

```
https://www.googleapis.com/auth/drive.file
```

Este scope permite a ObSave acceder **únicamente a los archivos y carpetas que el propio plugin crea o abre explícitamente** en Google Drive. ObSave **no puede** leer, modificar ni eliminar el resto de archivos de tu cuenta de Google Drive.

Durante la autorización, Google puede mostrarte el email y el nombre asociados a tu cuenta; ObSave los guarda localmente solo para mostrarte qué cuenta está conectada.

## Comunicación con terceros

ObSave se comunica exclusivamente con los servicios que **tú configuras**:

- **GitHub API** — cuando eliges GitHub como proveedor.
- **Google APIs** (OAuth, Drive, userinfo) — cuando eliges Google Drive.
- **Obsidian** — almacenamiento local de configuración del plugin.

No hay telemetría, analytics ni servidores propios de Ad Astra Forge en el flujo de sincronización.

## Almacenamiento de credenciales

Las credenciales (tokens OAuth2, PAT de GitHub, etc.) se almacenan **localmente** en la configuración de Obsidian de tu dispositivo, gestionada por la API de plugins de Obsidian (`loadData` / `saveData`). Ad Astra Forge no tiene acceso remoto a esos datos.

Eres responsable de proteger el acceso a tu equipo y a tu bóveda de Obsidian.

## Retención y eliminación

- Puedes **desconectar** un proveedor desde la configuración de ObSave; el plugin elimina las credenciales almacenadas localmente para ese proveedor.
- Puedes **revocar** el acceso de ObSave en [Google Account Permissions](https://myaccount.google.com/permissions) o regenerar/revocar tokens en GitHub en cualquier momento.
- Al desinstalar el plugin, la configuración asociada puede permanecer en los datos de Obsidian hasta que la elimines manualmente.

## Menores de edad

ObSave no está dirigido a menores de 13 años. No recopilamos datos de menores de forma consciente.

## Cambios a esta política

Publicaremos cambios relevantes en este repositorio. La fecha de «Última actualización» reflejará la versión vigente.

## Contacto y soporte

Para consultas sobre privacidad o soporte técnico:

- **Email:** [soporte@adastraforge.com](mailto:soporte@adastraforge.com)
- **Issues de GitHub:** [github.com/adastraforge/obsave/issues](https://github.com/adastraforge/obsave/issues)

---

*ObSave es software libre desarrollado por Ad Astra Forge. Consulta también nuestros [Términos de Servicio](TERMS.md).*
