/** CSI sequences, OSC sequences, and other single escapes — the shared "remove terminal
 * escape codes before matching plain text" helper used by both RateLimitDetector (menu
 * phrase matching) and AttentionDetector (idle-prompt matching), so the two pattern
 * definitions can't drift apart. */
const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}
