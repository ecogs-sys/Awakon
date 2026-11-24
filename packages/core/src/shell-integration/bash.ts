/**
 * Bash (and Git Bash) shell integration.
 *
 * Injected via `--init-file`, which REPLACES ~/.bashrc rather than adding to it — so
 * the very first thing this script does is source the user's own rc. Getting that
 * wrong means a user launches Awakon and finds their aliases, prompt and PATH tweaks
 * silently gone.
 *
 * Unlike PowerShell this must be a real file on disk (there is no `-EncodedCommand`
 * equivalent), but POSIX shells have no ExecutionPolicy, so a temp file is fine.
 *
 * NOTE: this is a normal template literal, NOT String.raw, because the script is full
 * of `${...}` parameter expansions which a template literal would otherwise treat as
 * JS interpolation. Hence `\${` for shell expansions and `\\` for literal backslashes.
 */
export const BASH_SHELL_INTEGRATION = `
# ---- Awakon shell integration (bash) -------------------------------------
# Source the user's own rc FIRST: --init-file replaces it, so skipping this would
# silently drop their aliases, prompt and exports.
if [ -f "\$HOME/.bashrc" ]; then . "\$HOME/.bashrc"; fi

__awakon_osc() { printf '\\033]%s\\007' "\$1"; }

# Minimal percent-encoding for OSC 7. Only the characters that actually break a
# file:// URL are escaped — a full byte-wise encoder would mangle UTF-8 paths.
# '%' must be first, or the escapes introduced below get double-encoded.
__awakon_encode_path() {
  local s="\$1"
  s="\${s//%/%25}"
  s="\${s// /%20}"
  s="\${s//#/%23}"
  s="\${s//\\?/%3F}"
  printf '%s' "\$s"
}

# The DEBUG trap fires before EVERY simple command, including the ones inside
# PROMPT_COMMAND. This flag collapses that to one report per command line: it is
# cleared on the first command after a prompt and only re-armed by the next prompt.
#
# Starts at 0, not 1: the trap is installed below and would otherwise fire on the
# remaining statements of THIS script, reporting e.g. \`case\` as the foreground
# program before the user has typed anything. The first real prompt arms it.
__awakon_at_prompt=0

__awakon_preexec() {
  # Tab completion runs commands in the background; those are not user commands.
  [ -n "\$COMP_LINE" ] && return
  [ "\$__awakon_at_prompt" != "1" ] && return
  __awakon_at_prompt=0
  __awakon_osc "133;C"
  __awakon_osc "1337;awakonCommand=\$BASH_COMMAND"
}

__awakon_precmd() {
  # Must be the first statement: anything else overwrites \$?.
  local __awakon_exit=\$?
  __awakon_at_prompt=1
  __awakon_osc "133;D;\$__awakon_exit"
  __awakon_osc "133;A"
  __awakon_osc "7;file://\$(__awakon_encode_path "\$PWD")"
  # Preserve the exit status for anything else chained into PROMPT_COMMAND.
  return \$__awakon_exit
}

# NOTE: bash allows only one DEBUG trap, so this replaces any the user had set.
# Nothing in a default setup installs one; frameworks that do (bash-preexec) would
# need chaining, which is why this is not attempted here.
trap '__awakon_preexec' DEBUG

# Prepend, so \$? is read before a user PROMPT_COMMAND can clobber it, and guard
# against double-installation if this file is somehow sourced twice.
case "\$PROMPT_COMMAND" in
  *__awakon_precmd*) ;;
  "")  PROMPT_COMMAND="__awakon_precmd" ;;
  *)   PROMPT_COMMAND="__awakon_precmd;\$PROMPT_COMMAND" ;;
esac
# ---- end Awakon shell integration ----------------------------------------
`;
