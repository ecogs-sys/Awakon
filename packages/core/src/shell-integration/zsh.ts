/**
 * Zsh shell integration.
 *
 * Injected by pointing ZDOTDIR at a temp directory containing this as `.zshrc`.
 * That replaces the user's `.zshrc`, so this sources theirs first — from the
 * original ZDOTDIR, passed through as AWAKON_USER_ZDOTDIR.
 *
 * Zsh is the easy case: it has first-class `preexec`/`precmd` hooks, so no DEBUG-trap
 * gymnastics are needed, and `add-zsh-hook` composes with whatever else is installed.
 *
 * NOTE: normal template literal, not String.raw — see bash.ts for why. `\${` is a
 * shell expansion, `\\` a literal backslash.
 */
export const ZSH_SHELL_INTEGRATION = `
# ---- Awakon shell integration (zsh) --------------------------------------
# Restore the real ZDOTDIR and source the user's own rc first: we hijacked ZDOTDIR
# purely to get loaded, and everything after this point must behave as if we had not.
__awakon_user_zdotdir="\${AWAKON_USER_ZDOTDIR:-\$HOME}"
ZDOTDIR="\$__awakon_user_zdotdir"
unset AWAKON_USER_ZDOTDIR
if [ -f "\$__awakon_user_zdotdir/.zshrc" ]; then
  . "\$__awakon_user_zdotdir/.zshrc"
fi

__awakon_osc() { printf '\\033]%s\\007' "\$1"; }

# Minimal percent-encoding for OSC 7 — only what breaks a file:// URL, so UTF-8
# paths survive intact. '%' must be substituted first.
__awakon_encode_path() {
  local s="\$1"
  s="\${s//'%'/%25}"
  s="\${s// /%20}"
  s="\${s//'#'/%23}"
  s="\${s//'?'/%3F}"
  printf '%s' "\$s"
}

# preexec receives the full command line as \$1 — no \$BASH_COMMAND guesswork.
__awakon_preexec() {
  __awakon_osc "133;C"
  __awakon_osc "1337;awakonCommand=\$1"
}

__awakon_precmd() {
  local __awakon_exit=\$?
  __awakon_osc "133;D;\$__awakon_exit"
  __awakon_osc "133;A"
  __awakon_osc "7;file://\$(__awakon_encode_path "\$PWD")"
  return \$__awakon_exit
}

autoload -Uz add-zsh-hook 2>/dev/null
if whence add-zsh-hook >/dev/null 2>&1; then
  add-zsh-hook preexec __awakon_preexec
  add-zsh-hook precmd  __awakon_precmd
fi
# ---- end Awakon shell integration -----------------------------------------
`;
