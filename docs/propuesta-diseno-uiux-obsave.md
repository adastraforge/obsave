# Propuesta de diseño UI/UX — ObSave

**Proyecto:** ObSave — Ad Astra Forge
**Código analizado:** rama `main`, commit `700f437` (`v1.1.5`; la solicitud referencia v1.1.4 y ninguno de los archivos de UI cambió entre ambas)
**Fecha:** 10 de septiembre de 2026
**Naturaleza del documento:** análisis conceptual y propuesta de diseño. **No contiene cambios aplicados al código.** Todos los fragmentos son maquetas ilustrativas.

---

## Resumen ejecutivo

| # | Área | Diagnóstico en una línea | Impacto usuario | Esfuerzo |
|---|------|--------------------------|-----------------|----------|
| 1 | Plantilla de notas | 26 líneas generadas, 0 de contenido real; 5 capas de duplicación del mismo dato | Alto | Bajo |
| 2 | Nombres de archivo | Se sustituyen espacios por `_` sin necesidad técnica y faltan 4 caracteres que sí rompen wikilinks | Medio-Alto | Bajo |
| 3 | Informe de bóveda | Listas planas sin jerarquía + lectura completa de cada `.md` en disco | Alto | Medio-Alto |
| 4 | Densidad en Ajustes | 19 textos descriptivos permanentes, de los cuales ~11 son redundantes | Medio | Bajo |

Las cuatro áreas comparten un mismo patrón de fondo: **el plugin explica en texto lo que la interfaz ya comunica por estructura**. La propuesta transversal es sustituir prosa por jerarquía visual, tooltips bajo demanda e iconografía nativa.

---

## 1. Plantilla de notas (`src/productivity/noteCapture.ts`)

### 1.1 Anatomía de lo que se genera hoy

Salida literal de «Captura de nota enriquecida» con título *Reunión Kickoff Cliente* en `01_Proyectos`:

```markdown
---
tipo: proyectos
fecha_creacion: 2026-09-10 17:12:04
fecha_atencion: 2026-09-10
estado: pendiente
tags:
  - #obsidian
  - #nota
  - #pendiente
---

# Reunión Kickoff Cliente

%% Sección General %%
> [!info] Información General
> **Tipo:** proyectos
> **Fecha de creación:** 2026-09-10 17:12:04
> **Atender el:** 2026-09-10
> **Estado:** Pendiente

%% Sección de Contenido %%
## Contenido
- Escribe aquí el detalle de la nota...

%% Notas / Tareas de seguimiento %%
- [ ] Tarea pendiente inicial
```

**26 líneas. Cero pertenecen al usuario.** Antes de escribir su primera palabra tiene que leer, entender y decidir qué borrar de un andamiaje que él no pidió.

### 1.2 Las cinco capas de duplicación

| Dato | Propiedades YAML | Callout `[!info]` | Nombre de archivo | Encabezado `# H1` | Título inline de Obsidian |
|------|:---:|:---:|:---:|:---:|:---:|
| Tipo | ✅ | ✅ | — | — | — |
| Fecha de creación | ✅ | ✅ | ✅ (en notas automáticas) | — | — |
| Fecha de atención | ✅ | ✅ | — | — | — |
| Estado | ✅ | ✅ (capitalizado) | — | — | — |
| Estado (otra vez) | ✅ como tag `#pendiente` | — | — | — | — |
| Título | — | — | ✅ | ✅ | ✅ |

El callout **no aporta ni un solo dato nuevo**. Es una reimpresión manual de las propiedades que Obsidian ya renderiza de forma nativa, editable e indexada en la cabecera de la nota. Peor: es una copia *desincronizada*. Si el usuario edita `estado` en el panel de propiedades, el callout sigue diciendo «Pendiente» indefinidamente, porque nada lo reescribe salvo el listener de movimiento entre carpetas.

El título aparece tres veces. Con «Mostrar título en línea» activado —el valor por defecto de Obsidian— el usuario ve el nombre del archivo como encabezado grande y, justo debajo, un `# H1` idéntico.

### 1.3 Los comentarios `%% … %%`

Hay tres: `%% Sección General %%`, `%% Sección de Contenido %%`, `%% Notas / Tareas de seguimiento %%`.

- **No se ven en Lectura**, pero **sí se ven en Live Preview** en cuanto el cursor entra en la línea, y siempre en modo Código fuente. Es decir: se ven precisamente cuando el usuario está escribiendo.
- **No cumplen ninguna función para el usuario.** Etiquetan secciones que ya llevan encabezado propio.
- **Sí tienen un acoplamiento técnico**, y conviene documentarlo antes de tocarlos: `updateNoteTipo` en `src/utils/frontmatter.ts` delimita el bloque a reescribir con

  ```ts
  /> \[!info\] Información General[\s\S]*?(?=\n%% Sección de Contenido %%|\n## Contenido|$)/
  ```

  La alternancia incluye `\n## Contenido`, así que **eliminar los comentarios no rompe nada**. Eliminar el callout tampoco: la función hace `infoBlockRe.test()` antes de sustituir, de modo que degrada a no-op y la actualización de `tipo` en el YAML se sigue aplicando. Esta es la razón por la que la limpieza es de bajo riesgo.

### 1.4 Hallazgo colateral: los tags del YAML probablemente no existen para Obsidian

```yaml
tags:
  - #obsidian
```

En YAML, una almohadilla precedida de espacio **abre un comentario**. El valor del elemento es nulo, no la cadena `#obsidian`. El parser propio de ObSave (`parseFrontmatter`) los lee bien porque usa expresiones regulares línea a línea, pero el índice nativo de Obsidian —el que alimenta el panel de tags, la búsqueda `tag:` y las consultas de Dataview— muy probablemente no ve ninguna etiqueta.

La convención documentada por Obsidian es escribir los tags del frontmatter **sin** almohadilla. Recomiendo verificarlo abriendo una nota generada y comprobando si aparece en el panel de etiquetas; si se confirma, es un fallo funcional silencioso que lleva presente desde que existe la plantilla.

También conviene revisar la lista en sí: `#obsidian` no discrimina nada dentro de una bóveda de Obsidian, y `#nota` no discrimina nada dentro de una colección de notas. El único tag con capacidad de filtrado es `#pendiente`, que además duplica la propiedad `estado`.

### 1.5 Propuesta de estructura

Dos variantes, asignadas a los dos puntos de entrada que ya existen en el código.

**Variante A — «Nota rápida (1 clic)» (`createQuickDailyNote`)**

El gesto es una captura instantánea. Cualquier andamiaje es fricción.

```markdown
---
tipo: diarias
fecha_creacion: 2026-09-10 17:12:04
fecha_atencion: 2026-09-10
estado: pendiente
tags:
  - pendiente
---

▏
```

**7 líneas de metadatos, cursor en la línea 9, listo para escribir.**

**Variante B — «Captura de nota enriquecida» (`createCaptureNote`)**

Aquí el usuario ya ha invertido tiempo en un formulario con fecha de atención y tags: hay intención de seguimiento, así que un único apartado de tareas está justificado.

```markdown
---
tipo: proyectos
fecha_creacion: 2026-09-10 17:12:04
fecha_atencion: 2026-09-10
estado: pendiente
tags:
  - pendiente
  - cliente
---

▏

## Seguimiento
- [ ] 
```

**Qué se elimina y por qué**

| Elemento | Decisión | Motivo |
|----------|----------|--------|
| Callout `> [!info] Información General` | **Eliminar** | Duplica el 100 % del YAML y se desincroniza en cuanto el usuario edita las propiedades |
| `%% Sección General %%` y los otros dos comentarios | **Eliminar** | Visibles al escribir, sin función; el acoplamiento con `updateNoteTipo` ya está cubierto por la alternancia `\n## Contenido` |
| `# ${heading}` | **Eliminar** | El nombre del archivo ya es el título y Obsidian lo muestra en línea por defecto |
| `## Contenido` | **Eliminar** | Un encabezado llamado «Contenido» sobre el contenido no aporta información |
| `- Escribe aquí el detalle de la nota...` | **Eliminar** | Un placeholder que hay que borrar antes de escribir es fricción neta |
| `- [ ] Tarea pendiente inicial` | **A: eliminar / B: dejar vacío** | La casilla vacía invita a la acción; el texto de relleno obliga a borrarlo |
| Tags `#obsidian` y `#nota` | **Eliminar** | Nulo poder de filtrado; además la almohadilla los invalida como YAML |
| Tag `#pendiente` → `pendiente` | **Conservar sin almohadilla** | Único tag con valor de filtrado; sin `#` sí lo indexa Obsidian |

**Balance:** de 26 líneas generadas a 9 (variante A) u 13 (variante B). De 5 duplicaciones del mismo dato a 1 (título en nombre de archivo, que es inevitable y correcto).

**Contrapartida honesta:** quien tenga desactivado «Mostrar título en línea» perderá el título visible en modo Lectura al quitar el `# H1`. Es una minoría y la solución nativa está a un clic en los ajustes de Obsidian; si se prefiere no asumirlo, la alternativa es conservar el `# H1` y eliminar todo lo demás, lo que sigue dejando la plantilla en 11 líneas.

### 1.6 Foco inicial: el detalle que más se nota

Hoy, tanto `createQuickDailyNote` como `createCaptureNote` terminan con:

```ts
await app.workspace.getLeaf(false).openFile(file);
```

El archivo se abre con el cursor en la posición 0, es decir, **dentro del frontmatter**. El usuario tiene que bajar con el ratón o el teclado hasta el cuerpo antes de escribir. Con la plantilla actual son 12 líneas de descenso.

La propuesta es que la nota se abra con el cursor ya colocado en la primera línea vacía del cuerpo y el editor enfocado:

```ts
// Maqueta conceptual — no aplicada
const leaf = app.workspace.getLeaf(false);
await leaf.openFile(file, { state: { mode: "source" } });

const view = leaf.view;
if (view instanceof MarkdownView) {
  view.editor.setCursor({ line: bodyStartLine, ch: 0 });
  view.editor.focus();
}
```

`bodyStartLine` es determinista porque la plantilla la genera el propio plugin: número de líneas del frontmatter más una. No hace falta buscarla.

Este cambio, por sí solo, convierte «crear nota» en un gesto de un paso. Es la mejora de mayor relación impacto/esfuerzo de todo el documento.

### 1.7 Un fallo de UX adyacente que conviene arreglar en la misma pasada

En `createCaptureNote`, si ya existe una nota con ese nombre:

```ts
if (app.vault.getAbstractFileByPath(path)) {
  new Notice(`ObSave: Ya existe ${path}`);
  return null;
}
```

Devuelve `null`, pero `CaptureNoteModal` no distingue el resultado:

```ts
await createCaptureNote(this.app, { … });
this.onCreated?.();
this.close();
```

**El modal se cierra igual y el usuario pierde todo lo que había escrito en el formulario.** Propuesta: o bien el modal permanece abierto y marca el campo de título en rojo, o bien la nota se crea con un sufijo automático (`Reunión Kickoff Cliente 2`). Esta segunda opción gana relevancia con la propuesta del punto 2, porque conservar espacios y mayúsculas aumenta la probabilidad de títulos repetidos.

---

## 2. Sanitización de nombres de notas

### 2.1 Lógica actual

```ts
function sanitizeFileName(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}
```

Tres operaciones, de las cuales **solo la primera responde a una restricción real del sistema operativo**.

### 2.2 Qué prohíbe realmente cada capa

| Carácter | Windows | macOS | Linux | Obsidian (wikilinks) | ¿Lo trata el código actual? |
|----------|:-------:|:-----:|:-----:|:--------------------:|------------------------------|
| `\ / :` | ❌ | ❌ (`:`) | ❌ (`/`) | ❌ | ✅ sustituye por `-` |
| `* ? " < > \|` | ❌ | ✔ | ✔ | ❌ (`\|`) | ✅ sustituye por `-` |
| `#` `^` `[` `]` | ✔ | ✔ | ✔ | ❌ **rompen `[[enlaces]]`** | ❌ **no se tratan** |
| Control `\x00-\x1F` | ❌ | ❌ | ❌ | ❌ | ❌ no se tratan |
| Punto inicial `.` | ✔ | oculta | oculta | ✔ | ❌ no se trata |
| Punto o espacio final | ❌ | ✔ | ✔ | ✔ | parcial (`trim` previo, no posterior) |
| Nombres reservados (`CON`, `NUL`, `COM1`…) | ❌ | ✔ | ✔ | ✔ | ❌ no se tratan |
| **Espacio** | **✔ permitido** | **✔ permitido** | **✔ permitido** | **✔ permitido** | ❌ **se sustituye sin necesidad** |

La conclusión salta a la vista: el sanitizador **transforma lo único que no hacía falta transformar y deja pasar cuatro caracteres que sí rompen la función más característica de Obsidian**, los enlaces internos. Un título como `Reunión #3 [borrador]` produce hoy un archivo llamado `Reunión_#3_[borrador].md` cuyo wikilink es inservible.

### 2.3 Consecuencias de sustituir espacios por `_`

1. **El nombre del archivo y el `# H1` divergen.** La plantilla escribe `# Reunión Kickoff Cliente` dentro de un archivo llamado `Reunión_Kickoff_Cliente.md`. Dos verdades para el mismo título.
2. **La búsqueda por nombre falla.** Escribir «Reunión Kickoff» en el conmutador rápido no encuentra `Reunión_Kickoff_Cliente` por coincidencia literal.
3. **El autocompletado de `[[` muestra ruido.** El usuario ve `Reunión_Kickoff_Cliente` en lugar de un título legible, y si quiere un alias limpio tiene que escribir `[[Reunión_Kickoff_Cliente|Reunión Kickoff Cliente]]`.
4. **La vista Grafo se vuelve ilegible** con decenas de nodos con guiones bajos.
5. **Contradice el comportamiento nativo.** Obsidian permite espacios al crear y renombrar notas. ObSave impone una convención que el propio host no impone, y el usuario no puede desactivarla.

### 2.4 Verificación técnica antes de recomendar espacios

La objeción legítima a conservar espacios es que rompan la sincronización, porque los espacios en rutas HTTP deben ir codificados. **Lo he comprobado en el código y no es un riesgo:**

- **GitHub** — `src/oauth/GitHubProvider.ts` codifica cada segmento antes de construir la URL:

  ```ts
  function encodePath(path: string): string {
    return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  }
  ```

  Todas las llamadas a `/contents/` pasan por ahí. Un espacio viaja como `%20`. Correcto.
- **Google Drive** — no usa rutas: opera con `fileId` y `parents`. El nombre viaja en el cuerpo JSON del multipart, donde un espacio es un carácter ordinario. Correcto.
- **Ledger** — `.obsave/ledger.json` indexa por ruta del vault en claves JSON. Los espacios son válidos en claves JSON y en `normalizePath`. Correcto.

Las contrapartidas que quedan son menores y todas cosméticas: URLs con `%20` si algún día se publica la bóveda como sitio web, y necesidad de comillas al manipular archivos desde la terminal, algo que el usuario no hace porque el plugin gestiona Git por él.

### 2.5 Sanitizador propuesto

```ts
// Maqueta conceptual — no aplicada
const CONTROL_CHARS   = /[\u0000-\u001F\u007F]/g;
const OS_FORBIDDEN    = /[\\/:*?"<>|]/g;   // Windows y macOS
const OBSIDIAN_UNSAFE = /[#^[\]]/g;         // rompen [[wikilinks]]
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function sanitizeFileName(raw: string): string {
  let name = raw
    .replace(CONTROL_CHARS, "")
    .replace(OS_FORBIDDEN, "-")
    .replace(OBSIDIAN_UNSAFE, "")
    .replace(/\s+/g, " ")        // colapsa espacios múltiples, NO los sustituye
    .trim()
    .replace(/^\.+/, "")          // sin punto inicial: evita archivos ocultos
    .replace(/[.\s]+$/, "");      // sin punto ni espacio final: requisito de Windows

  if (WINDOWS_RESERVED.test(name)) name = `${name} nota`;
  if (name.length > 120) name = name.slice(0, 120).trim();

  return name || "Nota sin título";
}
```

| Entrada del usuario | Hoy | Propuesta |
|---------------------|-----|-----------|
| `Nota Diaria 1` | `Nota_Diaria_1.md` | `Nota Diaria 1.md` |
| `Reunión #3 [borrador]` | `Reunión_#3_[borrador].md` ← wikilink roto | `Reunión 3 borrador.md` |
| `Informe 2026/2027` | `Informe_2026-2027.md` | `Informe 2026-2027.md` |
| `  espacios   raros  ` | `espacios___raros.md` | `espacios raros.md` |
| `CON` | `CON.md` ← ilegal en Windows | `CON nota.md` |
| `` (vacío tras limpiar) | `.md` ← archivo sin nombre | `Nota sin título.md` |

### 2.6 Nombres automáticos

La misma lógica aplica a las notas sin título, que hoy se llaman `Nota_diarias(2026-09-10_171204).md`. Los paréntesis y el guion bajo interno son legales, pero el resultado parece un identificador de máquina. Propuesta: `Diaria 2026-09-10 1712.md`, que conserva la ordenación cronológica alfabética y se lee como una frase. Los segundos son ruido visual; si preocupa la colisión dentro del mismo minuto, el sufijo automático del punto 1.7 la resuelve mejor que añadir dos dígitos a cada nombre.

### 2.7 Compatibilidad hacia atrás

El cambio afecta **solo a notas nuevas**. Las existentes con guiones bajos conservan su nombre y su entrada en el ledger; no hay renombrado masivo ni riesgo de resincronización. Si en el futuro se quisiera ofrecer una normalización retroactiva, debería ser una acción explícita del usuario y pasar por `fileManager.renameFile()` para que Obsidian actualice los enlaces entrantes, nunca por `vault.rename()`.

---

## 3. Rediseño del informe operativo de bóveda (`VaultReportModal.ts`)

### 3.1 Qué muestra hoy

```
┌─ Informe operativo de bóveda ──────────────────────┐
│ ┌────────────────────────────────────────────────┐ │
│ │ Contadores globales                            │ │
│ │ Total de carpetas                          14  │ │
│ │ Total de notas .md                        312  │ │
│ └────────────────────────────────────────────────┘ │
│                                                    │
│ 🚨 Atrasadas / Vencidas (12)                       │
│   • 01_Proyectos/Reunión_Kickoff_Cliente.md        │
│   • 04_Trabajo/Revisar_contrato.md                 │
│   • … (hasta 50, luego "… y N más.")               │
│                                                    │
│ 📅 Para Hoy (5)                                    │
│   • …                                              │
│ 📆 Esta Semana (23)                                │
│   • …                                              │
│ ✅ Atendidas (272)      ← 50 rutas seguidas        │
│   • …                                              │
│                                                    │
│ Desglose por carpetas                              │
│   • 00_Diarias: 64 nota(s)                         │
│   • 01_Proyectos: 96 nota(s)                       │
│   • … 12 carpetas más, sin orden por volumen       │
└────────────────────────────────────────────────────┘
```

Problemas de diseño, en orden de gravedad:

1. **Sin jerarquía.** Los cuatro bloques operativos usan el mismo `<h4>` y la misma `<ul>`. «Vencidas», que exige acción inmediata, tiene exactamente el mismo peso visual que «Atendidas», que es historia.
2. **La sección menos útil ocupa el mayor espacio.** «Atendidas» suele ser el bloque más numeroso —en el ejemplo, 272 notas— y renderiza hasta 50 rutas seguidas, empujando el desglose por carpetas fuera de la pantalla.
3. **Se muestran rutas, no notas.** `01_Proyectos/Reunión_Kickoff_Cliente.md` obliga a leer de izquierda a derecha para llegar a lo importante, que está al final.
4. **El corte en 50 es silencioso y sin salida.** «… y 22 más» no ofrece ninguna forma de verlas.
5. **El desglose por carpetas se ordena alfabéticamente.** Para una pregunta de volumen, el orden útil es descendente por número de notas.
6. **No hay una sola señal visual de proporción.** Todo son números sueltos; el usuario tiene que hacer la división mentalmente para saber si su bóveda está sana.
7. **No se puede filtrar, buscar ni reordenar.** Ni recargar sin cerrar y volver a abrir.

### 3.2 El problema de rendimiento es también un problema de UX

```ts
for (const file of app.vault.getMarkdownFiles()) {
  const content = await app.vault.read(file);   // lectura completa, secuencial
  const { frontmatter, body } = parseFrontmatter(content);
  …
}
```

Se lee **el contenido íntegro de cada nota, una detrás de otra**, para extraer cuatro campos del frontmatter y comprobar si hay una casilla marcada. En una bóveda de mil notas son mil operaciones de disco serializadas mientras el modal muestra «Calculando métricas…» sin barra de progreso ni posibilidad de cancelar.

Obsidian ya tiene esa información indexada en memoria:

```ts
// Maqueta conceptual — cero lecturas de disco
const cache = app.metadataCache.getFileCache(file);
const estado = cache?.frontmatter?.estado;
const dueDate = cache?.frontmatter?.fecha_atencion;
const hasCompletedTask = cache?.listItems?.some((item) => item.task === "x");
```

`CachedMetadata.frontmatter` y `CachedMetadata.listItems[].task` están disponibles en la versión de la API que usa el proyecto. El informe pasaría de segundos a instantáneo, y de paso desaparece la necesidad del parser propio `parseFrontmatter` para este caso de uso, con su fragilidad de expresiones regulares.

**Efecto secundario positivo:** al usar el índice nativo, si se corrige el problema de los tags con almohadilla del punto 1.4, la coherencia entre lo que ve ObSave y lo que ve Obsidian queda garantizada por construcción.

### 3.3 Maqueta propuesta

```
┌──────────────────────────────────────────────────────────────────────┐
│  Informe operativo de bóveda                          [⟳]  [×]       │
│  312 notas · 14 carpetas · actualizado hace unos segundos            │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐      │
│  │ ▲          │  │ ◉          │  │ ○          │  │ ✓          │      │
│  │   12       │  │    5       │  │   23       │  │  272       │      │
│  │ VENCIDAS   │  │ PARA HOY   │  │ ESTA SEMANA│  │ ATENDIDAS  │      │
│  │ ┃ rojo     │  │ ┃ ámbar    │  │ ┃ azul     │  │ ┃ verde    │      │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘      │
│      ↑ borde izquierdo de color = prioridad, legible sin leer        │
├──────────────────────────────────────────────────────────────────────┤
│  SALUD DE LA BÓVEDA          │  DISTRIBUCIÓN POR CARPETA             │
│                              │                                       │
│         ╭─────────╮          │  01_Proyectos  ████████████████  96   │
│        │   87 %   │         │  00_Diarias    ██████████        64   │
│        │ atendidas│         │  04_Trabajo    ███████           41   │
│         ╰─────────╯          │  03_Personales █████             28   │
│                              │  02_Ideas      ███               19   │
│   ● 272 atendidas            │  ─────────────────────────────────    │
│   ● 40 pendientes            │  [ Ver las 9 carpetas restantes ]     │
├──────────────────────────────────────────────────────────────────────┤
│  ┌ Vencidas ⑫ ┬ Hoy ⑤ ┬ Semana ㉓ ┬ Atendidas ㉜⑫ ┐  [🔍 filtrar…]  │
│  └────────────┴───────┴───────────┴───────────────┘                  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ ▲  Reunión Kickoff Cliente        hace 6 días   01_Proyectos   │  │
│  │ ▲  Revisar contrato               hace 3 días   04_Trabajo     │  │
│  │ ▲  Enviar propuesta               ayer          01_Proyectos   │  │
│  │                                                                │  │
│  │            [ Mostrar 9 restantes ]                             │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.4 Componentes propuestos

**a) Tarjetas KPI.** Cuatro tarjetas en rejilla adaptable. Cada una: icono Lucide, número grande (`font-size: 2.2em`, `font-variant-numeric: tabular-nums`), etiqueta en mayúsculas pequeñas y **barra de color de 3 px en el borde izquierdo** como codificación de prioridad. La tarjeta entera es un botón que activa la pestaña correspondiente de la lista inferior: el KPI deja de ser decorativo y se convierte en navegación.

En rejilla adaptable sin media queries:

```css
.obsave-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
}
.obsave-kpi-card {
  border: 1px solid var(--background-modifier-border);
  border-left: 3px solid var(--kpi-accent, var(--text-muted));
  border-radius: 10px;
  padding: 12px 14px;
  background: var(--background-primary-alt);
  cursor: pointer;
}
.obsave-kpi-card:hover { background: var(--background-modifier-hover); }
.obsave-kpi-value { font-size: 2.2em; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
.obsave-kpi-label { font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }

.obsave-kpi-card.is-overdue  { --kpi-accent: var(--color-red); }
.obsave-kpi-card.is-today    { --kpi-accent: var(--color-orange); }
.obsave-kpi-card.is-week     { --kpi-accent: var(--color-blue); }
.obsave-kpi-card.is-attended { --kpi-accent: var(--color-green); }
```

Los colores salen de las variables del tema, así que el informe respeta automáticamente el modo claro/oscuro y los temas de la comunidad.

**b) Dona de salud en SVG puro.** Sin librerías ni dependencias. El truco es un radio de `15.9155`, cuya circunferencia es exactamente 100, de modo que `stroke-dasharray` se expresa directamente en porcentaje:

```html
<svg viewBox="0 0 42 42" class="obsave-donut" role="img" aria-label="87 % de notas atendidas">
  <circle class="obsave-donut-track" cx="21" cy="21" r="15.9155"/>
  <circle class="obsave-donut-value" cx="21" cy="21" r="15.9155"
          stroke-dasharray="87 13" stroke-dashoffset="25"/>
  <text x="21" y="22.5" class="obsave-donut-text">87 %</text>
</svg>
```

```css
.obsave-donut { width: 120px; height: 120px; }
.obsave-donut circle { fill: none; stroke-width: 4; }
.obsave-donut-track { stroke: var(--background-modifier-border); }
.obsave-donut-value { stroke: var(--color-green); transform: rotate(-90deg); transform-origin: center; transition: stroke-dasharray .4s ease; }
.obsave-donut-text  { fill: var(--text-normal); font-size: 7px; font-weight: 700; text-anchor: middle; }
```

**c) Barras horizontales en CSS.** Ordenadas de mayor a menor, con las cinco primeras visibles y el resto tras un desplegable. El ancho dinámico debe pasarse por **propiedad personalizada**, no por estilo en línea, porque las directrices de revisión de plugins de la comunidad desaconsejan los estilos en línea:

```ts
// Maqueta conceptual
const bar = row.createDiv({ cls: "obsave-bar" });
bar.style.setProperty("--obsave-bar-width", `${(count / max) * 100}%`);
```

```css
.obsave-bar { height: 8px; border-radius: 4px; background: var(--background-modifier-border); }
.obsave-bar::after {
  content: ""; display: block; height: 100%; border-radius: 4px;
  width: var(--obsave-bar-width, 0%);
  background: var(--text-accent);
}
```

**d) Pestañas con badge de conteo.** Sustituyen a los cuatro `<h4>` apilados. Solo una lista visible a la vez, así que «Atendidas» deja de empujar el resto del informe fuera de la pantalla. La pestaña por defecto debe ser **Vencidas** si hay alguna, y **Para hoy** en caso contrario: el informe abre siempre en lo que requiere acción.

**e) Filas de nota en lugar de rutas.** Icono de prioridad, **título de la nota como texto principal**, antigüedad relativa («hace 6 días») y carpeta como texto atenuado a la derecha. La ruta completa pasa al `aria-label` y al tooltip.

**f) Paginación explícita.** «Mostrar 9 restantes» en vez del corte mudo en 50, y un campo de filtro que actúa sobre la pestaña activa.

**g) Botón de recarga** en la cabecera, para no tener que cerrar y reabrir el modal.

### 3.5 Jerarquía de la información

El orden de lectura propuesto responde a tres preguntas en secuencia, de lo general a lo concreto:

1. *¿Cuánto tengo pendiente y de qué urgencia?* → tarjetas KPI
2. *¿Voy bien o voy mal?* → dona de salud y distribución por carpeta
3. *¿Qué hago ahora?* → lista accionable, filtrable y abierta por defecto en lo urgente

El diseño actual invierte parcialmente este orden: empieza por dos contadores de inventario —carpetas y notas totales— que no responden a ninguna pregunta operativa, y esconde la distribución al final, después de hasta 200 líneas de rutas.

---

## 4. Densidad visual y de textos en Ajustes (`ObSaveSettingTab.ts`)

### 4.1 Criterio de decisión

Antes del inventario, la regla que aplico para clasificar cada texto:

| Situación | Tratamiento |
|-----------|-------------|
| El texto repite lo que dice la etiqueta del control | **Eliminar** |
| El texto describe el formato esperado de una entrada | **Placeholder** (`setPlaceholder`) |
| El texto es una aclaración útil pero no imprescindible | **Tooltip** (`setTooltip`) o botón `ⓘ` (`addExtraButton`) |
| El texto advierte de una consecuencia irreversible | **Se queda visible**, y además en el diálogo de confirmación |
| El texto orienta la primera vez y estorba las siguientes | **Estado vacío**: visible solo cuando no hay nada configurado |

Las tres APIs necesarias están disponibles en la versión de Obsidian que declara el proyecto: `Setting.setTooltip()`, `Setting.addExtraButton()` con `ExtraButtonComponent.setIcon()`, y las funciones globales `setIcon(el, nombre)` y `setTooltip(el, texto)`.

### 4.2 Inventario — Vista 1 (Home)

| Texto actual | Ubicación | Diagnóstico | Propuesta |
|--------------|-----------|-------------|-----------|
| «Asistente de sincronización en la nube» | Cabecera | Subtítulo permanente bajo un `h2` que ya dice «ObSave» | Fundir en la cabecera con el número de versión, en una sola línea |
| «Elige dónde quieres respaldar tu bóveda.» | Sección Respaldo y nube | Redundante: el título de sección lo dice y las tarjetas son obviamente seleccionables | **Eliminar** |
| «Respalda tu bóveda en un repositorio Git privado.» | Tarjeta GitHub | Útil la primera vez, ruido después | Conservar (es el criterio de elección entre proveedores) |
| «Guarda una copia segura en tu nube de Google.» | Tarjeta Drive | Ídem | Conservar |
| «Microsoft OneDrive — próximamente.» | Tarjeta OneDrive | **Duplica literalmente el badge «Próximamente»** que hay dos líneas más arriba | **Eliminar** el `— próximamente`; basta el badge |
| «Apple iCloud — próximamente.» | Tarjeta iCloud | Ídem | Ídem |
| «Organiza tu bóveda con carpetas de productividad predefinidas.» | Sección Estructura | El usuario no sabe *cuáles* son esas carpetas, que es la única información que necesita | Sustituir por la lista real como chips: `00_Diarias` `01_Proyectos` `02_Ideas` `03_Personales` `04_Trabajo` `05_Archivadas` |
| «Puedes personalizar los atajos de teclado para ObSave desde Ajustes → Atajos.» | Sección Herramientas | Meta-instrucción sobre otro panel, permanente, sin relación con los tres botones que hay debajo | **Eliminar** y trasladar a un `ⓘ` en el título de la sección |

**Maqueta comparativa:**

```
ANTES                                    DESPUÉS
─────────────────────────────────────    ─────────────────────────────────────
ObSave                                   ObSave                        v1.1.5
Asistente de sincronización en la nube
                                         ┌ ☁  RESPALDO Y NUBE ─────────────┐
┌ RESPALDO Y NUBE ─────────────────┐     │ ┌────────┐ ┌────────┐          │
│ Elige dónde quieres respaldar tu │     │ │GitHub  │ │G. Drive│          │
│ bóveda.                          │     │ │Sin cfg.│ │Conectad│          │
│ ┌────────┐ ┌────────┐            │     │ └────────┘ └────────┘          │
│ │GitHub  │ │G. Drive│            │     └─────────────────────────────────┘
│ │Sin cfg.│ │Conectad│            │
│ └────────┘ └────────┘            │     ┌ 📁 ESTRUCTURA DE BÓVEDA ────────┐
└──────────────────────────────────┘     │ 00_Diarias  01_Proyectos        │
                                         │ 02_Ideas    03_Personales       │
┌ ESTRUCTURA DE BÓVEDA ────────────┐     │ 04_Trabajo  05_Archivadas       │
│ Organiza tu bóveda con carpetas  │     │ [+ Generar carpetas]            │
│ de productividad predefinidas.   │     └─────────────────────────────────┘
│ [Generar carpetas de la bóveda]  │
└──────────────────────────────────┘     ┌ ⚡ HERRAMIENTAS            ⓘ ──┐
                                         │ [✎ Nota rápida]                 │
┌ HERRAMIENTAS Y PRODUCTIVIDAD ────┐     │ [+ Captura enriquecida]         │
│ Puedes personalizar los atajos   │     │ [▤ Informe de bóveda]           │
│ de teclado para ObSave desde     │     └─────────────────────────────────┘
│ Ajustes → Atajos.                │       ⓘ = tooltip con lo de los atajos
│ [Nota rápida (1 clic)]           │
│ [Captura de nota enriquecida]    │
│ [Informe operativo de bóveda]    │
└──────────────────────────────────┘
```

Se eliminan 4 párrafos, se sustituye 1 por información concreta y se ganan tres iconos que permiten localizar la sección de un vistazo. La altura de la Vista 1 se reduce aproximadamente un 30 % sin perder ninguna información que el usuario necesite más de una vez.

### 4.3 Inventario — Vista 2 (Asistente de conexión)

**Asistente de GitHub:** 6 campos, 7 descripciones permanentes.

| Campo | Descripción actual | Propuesta |
|-------|--------------------|-----------|
| Usuario de GitHub | «Opcional si tu token ya identifica la cuenta.» | **Tooltip.** La etiqueta ya se entiende; el matiz de opcionalidad interesa a quien duda |
| Token de acceso | «Personal Access Token con permiso de repositorio.» | **Se queda**, pero como `ⓘ` con enlace directo a la página de creación de tokens de GitHub. Es el único campo donde el usuario puede quedarse realmente bloqueado |
| Tipo de repositorio | «Elige cómo respaldar tu bóveda en GitHub.» | **Eliminar.** El desplegable dice «Crear nuevo repositorio / Usar repositorio existente»; la descripción no añade nada |
| Nombre del repositorio | «Nombre sugerido: "mi-boveda"» | **Placeholder.** El valor ya viene precargado con la sugerencia, así que el texto describe algo que el usuario está viendo |
| Repositorio privado | «Desactiva para crear un repositorio público.» | **Tooltip.** Un interruptor llamado «Repositorio privado» es autoexplicativo |
| Seleccionar repositorio | «Abre el selector de repositorios de tu cuenta GitHub.» | **Eliminar.** El botón dice «Elegir repositorio…» |
| URL / Nombre alternativo | «Ejemplo: usuario/mi-repo o https://github.com/usuario/mi-repo» | **Placeholder** (ya existe uno: `usuario/mi-repo`). Eliminar la descripción |

De 7 descripciones a 1 visible más 2 tooltips. **Reducción del 85 % del texto permanente.**

**Asistente de Google Drive:** 4 descripciones.

| Elemento | Descripción actual | Propuesta |
|----------|--------------------|-----------|
| Encabezado | «Configura la carpeta de respaldo y vincula tu cuenta de Google Drive.» | **Eliminar.** Ya existe «Configura Google Drive» dos líneas arriba: son la misma frase |
| Tipo de carpeta | «Elige si ObSave crea una carpeta nueva o usa una existente.» | **Eliminar.** Reformula literalmente las dos opciones del desplegable |
| Nombre de la carpeta | «Se creará en Drive al sincronizar. Sugerido: "…"» | Conservar solo «Se creará en la primera sincronización»; la sugerencia ya está en el campo |
| Vincular Google Drive | «Se abrirá el navegador para autorizar el acceso.» | **Se queda.** Advierte de que la aplicación pierde el foco: es información sobre lo que va a pasar, no sobre lo que hay en pantalla |

**Un problema estructural adicional en esta vista:** el asistente de GitHub muestra hasta 6 campos simultáneamente, sin numeración ni indicador de progreso. Al ser un flujo de conexión con un orden natural —credenciales, luego destino, luego confirmar—, se beneficiaría de un patrón de pasos:

```
  ①━━━━━━━━━②─────────③
Credenciales  Destino  Listo
```

Bastaría con revelar el bloque de repositorio solo cuando haya un token introducido. Reduce a la mitad la información en pantalla en el momento inicial y elimina el error más frecuente, que es pulsar «Elegir repositorio…» antes de escribir el token —error que hoy se gestiona con un `Notice` reactivo en lugar de prevenirse.

### 4.4 Iconografía Lucide propuesta

Obsidian incluye Lucide y lo expone con `setIcon(elemento, nombre)`. Sugerencia de asignación:

| Elemento | Icono | Justificación |
|----------|-------|---------------|
| Sección Respaldo y nube | `cloud` | — |
| Sección Estructura de bóveda | `folder-tree` | — |
| Sección Herramientas | `zap` | — |
| Nota rápida | `pencil-line` | Escritura inmediata |
| Captura enriquecida | `file-plus-2` | Creación con formulario |
| Informe de bóveda | `bar-chart-3` | Coherente con el rediseño del punto 3 |
| Generar carpetas | `folder-plus` | — |
| Sincronizar ahora | `refresh-cw` | Convención universal |
| Desconectar | `unlink` | — |
| Reparar bóveda remota | `wrench` | — |
| Ayuda contextual | `help-circle` | — |
| Estado sincronizado / pendiente / error | `check-circle-2` / `clock` / `alert-triangle` | Coherente con los colores verde/ámbar/rojo de los badges del explorador |

Los iconos de estado deberían usar **exactamente la misma paleta** que los puntos del explorador de archivos (`.obsave-dot-synced`, `-modified`, `-new`). Hoy no hay ninguna relación visual entre el badge del explorador y el estado que se muestra en el panel de ajustes, y son la misma información.

### 4.5 Bonus — Vista 3 (Panel de sincronización)

Aunque no estaba en el encargo, aparecen dos cuestiones de la misma familia:

1. **«Reparar / Reconstruir Bóveda Remota»** usa una descripción de 24 palabras y repite el nombre completo en la etiqueta del botón, en el título del ajuste y en el estado «Reconstruyendo…». Propuesta: título «Reparar bóveda remota», botón «Reparar…», y el texto largo únicamente dentro del diálogo de confirmación, que es donde el usuario está decidiendo de verdad.
2. **El diálogo de confirmación usa `confirm()` nativo del navegador.** Rompe la estética de Obsidian, no respeta el tema y no es coherente con `showProviderBlockedModal`, que sí usa un `Modal` correcto y ya existe en este mismo archivo. Reutilizar ese patrón daría consistencia y permitiría destacar la acción destructiva con `setWarning()`.

---

## 5. Plan de implementación sugerido

Ordenado por relación impacto/riesgo, no por número de sección.

| Fase | Alcance | Archivos | Riesgo |
|------|---------|----------|--------|
| **1** | Foco del cursor al crear nota + plantilla minimalista + tags sin almohadilla | `noteCapture.ts`, `frontmatter.ts` | Bajo. `updateNoteTipo` degrada a no-op de forma segura |
| **2** | Sanitizador de nombres con espacios y caracteres inseguros para wikilinks | `noteCapture.ts` | Bajo. Solo afecta a notas nuevas |
| **3** | Modal de captura: no cerrar en caso de error, sufijo automático ante colisión | `CaptureNoteModal.ts`, `noteCapture.ts` | Bajo |
| **4** | Limpieza de textos e iconos en Ajustes Vista 1 y Vista 2 | `ObSaveSettingTab.ts` | Bajo. Solo presentación |
| **5** | Informe: migrar a `metadataCache` (sin cambio visual) | `VaultReportModal.ts` | Medio. Cambia la fuente de los datos; conviene validar los conteos contra el método actual |
| **6** | Informe: KPI, dona, barras, pestañas | `VaultReportModal.ts`, `styles.css` | Medio-Alto. Es el rediseño más extenso |
| **7** | Asistente de conexión por pasos progresivos | `ObSaveSettingTab.ts` | Medio. Toca el flujo de conexión, que es crítico |

La fase 5 debe preceder a la 6: no conviene rediseñar la presentación y cambiar la fuente de datos en el mismo movimiento, porque cualquier discrepancia en los conteos sería imposible de atribuir.

---

## 6. Decisiones que requieren tu criterio

1. **`# H1` en la plantilla.** Recomiendo eliminarlo porque el nombre del archivo ya es el título y Obsidian lo muestra en línea por defecto. ¿Prefieres conservarlo por si algún usuario tiene desactivada esa opción?
2. **Tags por defecto.** Propongo dejar únicamente `pendiente`. ¿Quieres mantener alguno más para conservar la trazabilidad de las notas creadas por ObSave, por ejemplo `obsave`?
3. **Variantes A y B.** ¿Te convence diferenciar la plantilla entre «Nota rápida» (mínima) y «Captura enriquecida» (con apartado de seguimiento), o prefieres una única plantilla para ambas?
4. **Nombres automáticos.** `Diaria 2026-09-10 1712.md` frente al actual `Nota_diarias(2026-09-10_171204).md`: ¿te parece bien perder los segundos del nombre a cambio de legibilidad?
5. **Normalización retroactiva.** El cambio de sanitizador solo afecta a notas nuevas. ¿Quieres que se estudie una acción manual de renombrado masivo para las existentes, o dejamos la convención antigua intacta?
6. **Alcance del rediseño del informe.** ¿Prefieres el rediseño completo del punto 3 o una versión intermedia, por ejemplo solo las tarjetas KPI y el orden por volumen en las carpetas, dejando las pestañas y los gráficos para más adelante?

---

*Documento generado por análisis estático del código en `main@700f437`. No se ha modificado ningún archivo del complemento.*
