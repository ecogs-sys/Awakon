/**
 * Which foreground programs auto-resume applies to.
 *
 * Before shell integration, the rate-limit phrase was scanned in EVERY session's
 * output at all times, so anything that happened to print it — `cat` of a log, a
 * test fixture, a remote command's output — could make Awakon type the response
 * into that session. That hazard is why auto-resume ships disabled by default.
 * Knowing which program is in the foreground lets detection be armed only while a
 * CLI that actually has a rate-limit prompt is running.
 *
 * Membership here is NOT "has rate limits" — it is "shows an interactive prompt that
 * answering will resume". Researched against the real CLIs:
 *
 *  - Claude Code  shows a menu ("1. Stop and wait for limit to reset" / "2. Upgrade"),
 *                 and answering 1 makes it wait and resume on its own. Automatable.
 *  - Codex        either self-switches model ("Automatically switched to … due to
 *                 usage limits") or hard-stops ("You've hit your usage limit.
 *                 Upgrade to Plus…"). Nothing to answer; typing at it would not
 *                 resume anything.
 *  - Gemini CLI   self-downgrades ("Switching to the … model for the rest of this
 *                 session") or hard-stops ("Rate limit exceeded. Try again later.").
 *                 Again nothing to answer.
 *
 * So Codex and Gemini are deliberately absent: adding them would type into a session
 * that has no prompt waiting, which is worse than doing nothing.
 */
export const AUTO_RESUME_AGENT_COMMANDS: ReadonlySet<string> = new Set(['claude']);

/** True when auto-resume's detector should be listening in a session running `command`. */
export function isAutoResumeAgent(command: string | null | undefined): boolean {
  return command !== null && command !== undefined && AUTO_RESUME_AGENT_COMMANDS.has(command);
}
