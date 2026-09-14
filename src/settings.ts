export type HealthImpact = "positive" | "negative" | "neutral";

export interface NoteStatus {
	id: string;
	name: string;
	color: string;
	healthImpact: HealthImpact;
}

export interface NoteType {
	id: string;
	name: string;
}

export interface ObSaveSettings {
	statuses: NoteStatus[];
	types: NoteType[];
}

/** Paleta de 10 colores para el gestor de estados. */
export const STATUS_COLOR_PALETTE = [
	"#EAB308",
	"#F97316",
	"#EF4444",
	"#EC4899",
	"#A855F7",
	"#8B5CF6",
	"#3B82F6",
	"#14B8A6",
	"#22C55E",
	"#6B7280",
] as const;

export const HEALTH_IMPACT_OPTIONS: { id: HealthImpact; label: string }[] = [
	{ id: "positive", label: "Positivo" },
	{ id: "neutral", label: "Neutral" },
	{ id: "negative", label: "Negativo" },
];

export const DEFAULT_STATUSES: NoteStatus[] = [
	{ id: "pendientes", name: "Pendientes", color: "#EAB308", healthImpact: "neutral" },
	{ id: "pausadas", name: "Pausadas", color: "#6B7280", healthImpact: "neutral" },
	{ id: "canceladas", name: "Canceladas", color: "#EF4444", healthImpact: "negative" },
	{ id: "atendidas", name: "Atendidas", color: "#22C55E", healthImpact: "positive" },
];

export const DEFAULT_TYPES: NoteType[] = [
	{ id: "diaria", name: "Diaria" },
	{ id: "idea", name: "Idea" },
	{ id: "proyecto", name: "Proyecto" },
];

export const DEFAULT_SETTINGS: ObSaveSettings = {
	statuses: DEFAULT_STATUSES.map((status) => ({ ...status })),
	types: DEFAULT_TYPES.map((type) => ({ ...type })),
};

const HEX_COLOR_RE = /^#([0-9A-Fa-f]{6})$/;

/** Claves del data.json de sync (v1.x) que no deben sobrevivir. */
const LEGACY_SYNC_KEYS = [
	"activeProvider",
	"providerConfig",
	"syncIntervalSeconds",
	"syncIntervalMinutes",
	"autoSyncEnabled",
	"lastSyncAt",
	"syncStatus",
	"syncedLedger",
	"deviceName",
] as const;

export function isHexColor(value: string): boolean {
	return HEX_COLOR_RE.test(value.trim());
}

export function normalizeHexColor(value: string, fallback = "#6B7280"): string {
	const trimmed = value.trim();
	if (isHexColor(trimmed)) {
		return trimmed.toUpperCase();
	}
	if (/^#([0-9A-Fa-f]{3})$/.test(trimmed)) {
		const [, short] = trimmed.match(/^#([0-9A-Fa-f]{3})$/) ?? [];
		return `#${short[0]}${short[0]}${short[1]}${short[1]}${short[2]}${short[2]}`.toUpperCase();
	}
	return fallback;
}

export function slugify(raw: string): string {
	return raw
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
}

export function uniqueEntityId(
	name: string,
	existing: Array<{ id: string }>,
	fallback: string,
): string {
	const base = slugify(name) || fallback;
	const taken = new Set(existing.map((item) => item.id));
	if (!taken.has(base)) {
		return base;
	}
	let suffix = 2;
	while (taken.has(`${base}-${suffix}`)) {
		suffix++;
	}
	return `${base}-${suffix}`;
}

export function firstStatus(settings: ObSaveSettings): NoteStatus {
	return settings.statuses[0] ?? DEFAULT_STATUSES[0];
}

export function firstType(settings: ObSaveSettings): NoteType {
	return settings.types[0] ?? DEFAULT_TYPES[0];
}

function normalizeKey(raw: string): string {
	return slugify(stripPropertyQuotes(raw)) || raw.trim().toLowerCase();
}

/** Quita comillas YAML y espacios: `"Pausadas"` y `pausadas` colapsan al mismo id. */
export function stripPropertyQuotes(raw: string): string {
	return raw.trim().replace(/^["']|["']$/g, "").trim();
}

export function coercePropertyValue(raw: unknown): string {
	if (typeof raw === "string") {
		return stripPropertyQuotes(raw);
	}
	if (raw == null) {
		return "";
	}
	return stripPropertyQuotes(String(raw));
}

const STATUS_ALIASES: Record<string, string> = {
	pendiente: "pendientes",
	pendientes: "pendientes",
	pausada: "pausadas",
	pausadas: "pausadas",
	cancelada: "canceladas",
	canceladas: "canceladas",
	atendido: "atendidas",
	atendida: "atendidas",
	atendidas: "atendidas",
};

/**
 * Resuelve el frontmatter `estado` contra la lista configurada (id, nombre o alias).
 */
export function resolveStatus(
	raw: unknown,
	statuses: NoteStatus[],
): NoteStatus | null {
	const value = coercePropertyValue(raw);
	if (!value) {
		return null;
	}
	const key = normalizeKey(value);
	const aliased = STATUS_ALIASES[key] ?? key;
	return (
		statuses.find(
			(status) =>
				status.id === aliased ||
				status.id === key ||
				normalizeKey(status.name) === key ||
				status.name === value,
		) ?? null
	);
}

export function resolveType(raw: unknown, types: NoteType[]): NoteType | null {
	const value = coercePropertyValue(raw);
	if (!value) {
		return null;
	}
	const key = normalizeKey(value);
	return (
		types.find(
			(type) =>
				type.id === key ||
				normalizeKey(type.name) === key ||
				type.name === value,
		) ?? null
	);
}

/** Nombre canónico para YAML: acepta id o etiqueta. */
export function canonicalStatusName(
	raw: unknown,
	statuses: NoteStatus[],
): string | null {
	return resolveStatus(raw, statuses)?.name ?? null;
}

export function canonicalTypeName(
	raw: unknown,
	types: NoteType[],
): string | null {
	return resolveType(raw, types)?.name ?? null;
}

/** Tinta legible sobre un fondo dado: evita el check blanco sobre amarillo. */
export function readableInk(hex: string): string {
	const normalized = normalizeHexColor(hex);
	const r = parseInt(normalized.slice(1, 3), 16);
	const g = parseInt(normalized.slice(3, 5), 16);
	const b = parseInt(normalized.slice(5, 7), 16);
	return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#111827" : "#FFFFFF";
}

export function statusIcon(impact: HealthImpact): string {
	if (impact === "positive") return "check-circle-2";
	if (impact === "negative") return "x-circle";
	return "circle-dot";
}

function sanitizeStatus(
	raw: unknown,
	existing: NoteStatus[],
): NoteStatus | null {
	if (!raw || typeof raw !== "object") {
		return null;
	}
	const candidate = raw as Partial<NoteStatus>;
	const name =
		typeof candidate.name === "string" && candidate.name.trim()
			? candidate.name.trim()
			: "";
	if (!name) {
		return null;
	}
	const impact: HealthImpact =
		candidate.healthImpact === "positive" ||
		candidate.healthImpact === "negative" ||
		candidate.healthImpact === "neutral"
			? candidate.healthImpact
			: "neutral";
	const id =
		typeof candidate.id === "string" && candidate.id.trim()
			? slugify(candidate.id) || uniqueEntityId(name, existing, "estado")
			: uniqueEntityId(name, existing, "estado");
	return {
		id,
		name,
		color: normalizeHexColor(
			typeof candidate.color === "string" ? candidate.color : "",
		),
		healthImpact: impact,
	};
}

function sanitizeType(raw: unknown, existing: NoteType[]): NoteType | null {
	if (!raw || typeof raw !== "object") {
		return null;
	}
	const candidate = raw as Partial<NoteType>;
	const name =
		typeof candidate.name === "string" && candidate.name.trim()
			? candidate.name.trim()
			: "";
	if (!name) {
		return null;
	}
	const id =
		typeof candidate.id === "string" && candidate.id.trim()
			? slugify(candidate.id) || uniqueEntityId(name, existing, "tipo")
			: uniqueEntityId(name, existing, "tipo");
	return { id, name };
}

export function mergeStoredSettings(stored: unknown): ObSaveSettings {
	if (!stored || typeof stored !== "object") {
		return {
			statuses: DEFAULT_STATUSES.map((status) => ({ ...status })),
			types: DEFAULT_TYPES.map((type) => ({ ...type })),
		};
	}

	const record = stored as Record<string, unknown>;
	const statuses: NoteStatus[] = [];
	if (Array.isArray(record.statuses)) {
		for (const item of record.statuses) {
			const status = sanitizeStatus(item, statuses);
			if (status && !statuses.some((entry) => entry.id === status.id)) {
				statuses.push(status);
			}
		}
	}

	const types: NoteType[] = [];
	if (Array.isArray(record.types)) {
		for (const item of record.types) {
			const type = sanitizeType(item, types);
			if (type && !types.some((entry) => entry.id === type.id)) {
				types.push(type);
			}
		}
	}

	return {
		statuses:
			statuses.length > 0
				? statuses
				: DEFAULT_STATUSES.map((status) => ({ ...status })),
		types: types.length > 0 ? types : DEFAULT_TYPES.map((type) => ({ ...type })),
	};
}

export function hasLegacySyncPayload(stored: unknown): boolean {
	if (!stored || typeof stored !== "object") {
		return false;
	}
	const record = stored as Record<string, unknown>;
	return LEGACY_SYNC_KEYS.some((key) => key in record);
}
