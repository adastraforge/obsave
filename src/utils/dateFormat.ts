/** Formatea ISO 8601 a fecha/hora local legible: YYYY-MM-DD HH:mm:ss */
export function formatLocalDateTime(isoString: string | null | undefined): string {
	if (!isoString) return "Nunca";

	const date = new Date(isoString);
	if (Number.isNaN(date.getTime())) return "Nunca";

	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	const h = String(date.getHours()).padStart(2, "0");
	const min = String(date.getMinutes()).padStart(2, "0");
	const s = String(date.getSeconds()).padStart(2, "0");

	return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

/** Texto relativo para la última sincronización (ej. "Hace 5 minutos"). */
export function formatRelativeSyncTime(
	isoString: string | null | undefined,
): string {
	if (!isoString) return "Nunca";

	const date = new Date(isoString);
	if (Number.isNaN(date.getTime())) return "Nunca";

	const diffMs = Date.now() - date.getTime();
	if (diffMs < 0) return "Hace un momento";

	const minutes = Math.floor(diffMs / 60_000);
	if (minutes < 1) return "Hace un momento";
	if (minutes === 1) return "Hace 1 minuto";
	if (minutes < 60) return `Hace ${minutes} minutos`;

	const hours = Math.floor(minutes / 60);
	if (hours === 1) return "Hace 1 hora";
	if (hours < 24) return `Hace ${hours} horas`;

	const days = Math.floor(hours / 24);
	if (days === 1) return "Hace 1 día";
	return `Hace ${days} días`;
}
