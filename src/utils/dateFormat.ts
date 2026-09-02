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
