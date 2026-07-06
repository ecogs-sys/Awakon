/** Strip control sequences a malicious clipboard payload could use to escape xterm's
 * bracketed-paste wrapping (A6-I1). xterm.paste() wraps the text in ESC[200~ / ESC[201~
 * so the shell treats it as a single pasted blob rather than live keystrokes — but that
 * protection only holds if the pasted text itself cannot contain an ESC byte. A payload
 * embedding a forged ESC[201~ end-marker would terminate the paste early and get
 * whatever follows interpreted as directly typed input (including a trailing \r that
 * submits it as a command). Strip ESC entirely and collapse CR/CRLF to LF so no lone \r
 * is passed through either. */
export function sanitizePasteText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b/g, '').replace(/\r\n?/g, '\n');
}
