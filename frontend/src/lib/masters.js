import { api, duplicateWarning } from "@/lib/api";

/**
 * Adds a master record, pausing to confirm when the backend spots a near-duplicate
 * ("Raj Textiles" vs "Raj Textile"), which would otherwise split one customer's
 * history across two records.
 *
 * Returns the created record, or null if the user decided not to add it.
 * Any other error is re-thrown for the caller to report as usual.
 */
export async function addMasterConfirmed(type, payload) {
  try {
    return await api.addMaster(type, payload);
  } catch (e) {
    const dup = duplicateWarning(e);
    if (!dup) throw e;
    const list = dup.similar.map((s) => `   ·  ${s.name}${s.city ? ` — ${s.city}` : ""}`).join("\n");
    const proceed = window.confirm(
      `${dup.message}\n\n${list}\n\nAdd “${payload.name}” as a separate new record anyway?`
    );
    if (!proceed) return null;
    return await api.addMaster(type, { ...payload, force: true });
  }
}
