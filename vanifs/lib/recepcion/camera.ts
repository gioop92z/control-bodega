export const CAMERA_CONFIRMATION_MS = 1000;
const REPEAT_GUARD_MS = 1200;
const LABEL_CLEAR_MS = 450;

export function cameraGate() {
  let visible = "";
  let seenAt = -Infinity;
  const accepted = new Map<string, number>();
  return (code: string, at: number) => {
    if (!code) {
      if (at - seenAt >= LABEL_CLEAR_MS) visible = "";
      return false;
    }
    seenAt = at;
    if (code === visible) return false;
    for (const [key, prior] of accepted) if (at - prior >= REPEAT_GUARD_MS) accepted.delete(key);
    if (accepted.has(code)) return false;
    visible = code;
    accepted.set(code, at);
    return true;
  };
}
