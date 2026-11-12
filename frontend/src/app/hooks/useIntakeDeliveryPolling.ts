"use client";
import { useEffect, useRef } from "react";
import type { IntakeDelivery } from "@mike/contracts";
import { getIntakeDeliveryStatus } from "@/app/lib/mikeApi";

/** One bounded request at a time, with retry delay preserved across renders. */
export function useIntakeDeliveryPolling(orgId: string, requestId: string,
  deliveries: IntakeDelivery[], onUpdate: (rows: IntakeDelivery[]) => void,
  onAccessLost: () => void) {
  const callbacks = useRef({ onUpdate, onAccessLost });
  useEffect(() => { callbacks.current = { onUpdate, onAccessLost }; });
  const idsKey = JSON.stringify([...new Set(deliveries.filter(d => d.status === "pending")
    .map(d => d.outbound_id))].sort());
  useEffect(() => {
    const ids = JSON.parse(idsKey) as string[];
    if (!ids.length) return;
    const controller = new AbortController();
    let delay = 5_000;
    let offset = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const rows = await getIntakeDeliveryStatus(orgId, requestId, ids.slice(offset, offset + 100), controller.signal);
        if (controller.signal.aborted) return;
        callbacks.current.onUpdate(rows);
        offset = offset + 100 >= ids.length ? 0 : offset + 100;
        delay = 5_000;
      } catch (error) {
        if (controller.signal.aborted) return;
        const status = (error as { status?: number })?.status;
        if (status && [401, 403, 404].includes(status)) {
          callbacks.current.onAccessLost();
          return;
        }
        const retryAfter = (error as { retryAfterMs?: number })?.retryAfterMs ?? 0;
        delay = Math.max(Math.min(delay * 2, 60_000), Number.isFinite(retryAfter) ? retryAfter : 0);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, Math.min(delay, 2_147_483_647));
    };
    timer = setTimeout(poll, Math.min(delay, 2_147_483_647));
    return () => { controller.abort(); clearTimeout(timer); };
  }, [orgId, requestId, idsKey]);
}
