/**
 * Responses API passthrough — internal commentary-phase suppression (#6199).
 *
 * The Responses streaming passthrough must not forward internal commentary-phase
 * output to clients. A commentary item is announced by `response.output_item.added`
 * (which carries the `phase`), but its follow-up `response.output_text.delta` /
 * `response.output_text.done` / `response.output_item.done` events only carry
 * `item_id` / `output_index`. This helper tracks the announced commentary item id +
 * output index in two caller-owned Sets and reports whether the current event should
 * be dropped, so the hot per-chunk loop in stream.ts stays a single call.
 */

import { isResponsesCommentaryMessageItem } from "../handlers/responseSanitizer.ts";

type JsonRecord = Record<string, unknown>;

/**
 * Decide whether a single Responses SSE event is internal commentary that must be
 * dropped before forwarding. Mutates the two tracking Sets: an `output_item.added`
 * for a commentary item is recorded (and dropped); its trailing events are dropped
 * while tracked; the item's `output_item.done` clears the tracking.
 *
 * @returns true when the event should be dropped (the caller should `continue`).
 */
export function shouldDropResponsesCommentaryEvent(
  parsed: JsonRecord,
  commentaryItemIds: Set<string>,
  commentaryIndexes: Set<number>
): boolean {
  const eventType = parsed.type as string;
  const eventOutputIndex = typeof parsed.output_index === "number" ? parsed.output_index : null;
  const eventItem =
    parsed.item && typeof parsed.item === "object" && !Array.isArray(parsed.item)
      ? (parsed.item as JsonRecord)
      : null;
  const eventItemId =
    typeof parsed.item_id === "string"
      ? parsed.item_id
      : eventItem && typeof eventItem.id === "string"
        ? eventItem.id
        : null;

  if (eventType === "response.output_item.added" && isResponsesCommentaryMessageItem(parsed.item)) {
    if (eventItemId) commentaryItemIds.add(eventItemId);
    if (eventOutputIndex !== null) commentaryIndexes.add(eventOutputIndex);
    return true;
  }

  const belongsToCommentary =
    (eventItemId !== null && commentaryItemIds.has(eventItemId)) ||
    (eventOutputIndex !== null && commentaryIndexes.has(eventOutputIndex));
  if (!belongsToCommentary) return false;

  if (eventType === "response.output_item.done") {
    if (eventItemId) commentaryItemIds.delete(eventItemId);
    if (eventOutputIndex !== null) commentaryIndexes.delete(eventOutputIndex);
  }
  return true;
}
