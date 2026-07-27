import { TerminalHost, type PreloadBridge } from '@awakon/terminal-host';
import type { SessionId, Shell, PersistedSplitNode } from '@awakon/contracts';
import { IpcChannel } from '@awakon/contracts';
import { showContextMenu, buildTerminalContextMenu } from './context-menu.js';
import { ACCELERATOR_PLATFORM } from './platform.js';

type Orientation = 'horizontal' | 'vertical';

interface LeafNode {
  kind: 'leaf';
  sessionId: SessionId;
  host: TerminalHost;
  el: HTMLElement;
}

interface BranchNode {
  kind: 'branch';
  orientation: Orientation;
  ratio: number; // 0..1
  a: SplitNode;
  b: SplitNode;
  el: HTMLElement;
}

type SplitNode = LeafNode | BranchNode;

export interface SplitContainerOptions {
  rootEl: HTMLElement;
  bridge: PreloadBridge;
  initialSessionId: SessionId;
  shell: Shell;
  cwd: string;
}

export class SplitContainer {
  private root: SplitNode;
  private focused: LeafNode;
  private readonly bridge: PreloadBridge;
  private readonly shell: Shell;
  private readonly cwd: string;
  private readonly rootEl: HTMLElement;
  /** Primary session id of the owning tab — sent with every pane create so main can
   * scope pane cleanup to this tab. Reassigned by retarget() when main promotes a
   * sibling pane to primary after the original primary pane closes (see H2). */
  private tabId: SessionId;
  /** When true, persist() is a no-op. Used during restore() to avoid emitting one
   * IPC call per replayed split during startup — a single final persist runs once
   * the tree has been fully rebuilt. */
  private restoring: boolean = false;

  constructor(opts: SplitContainerOptions) {
    this.bridge = opts.bridge;
    this.shell = opts.shell;
    this.cwd = opts.cwd;
    this.rootEl = opts.rootEl;
    this.tabId = opts.initialSessionId;
    const leafEl = this.makePaneElement();
    this.rootEl.appendChild(leafEl);
    const host = new TerminalHost({ container: leafEl, sessionId: opts.initialSessionId, bridge: this.bridge });
    this.root = { kind: 'leaf', sessionId: opts.initialSessionId, host, el: leafEl };
    this.focused = this.root;
    leafEl.addEventListener('focusin', () => {
      // Walk the tree to find the leaf with this DOM element — keeps focus tracking correct after splits.
      this.focused = this.findLeafByElement(leafEl) ?? this.focused;
    });
  }

  async splitFocused(orientation: Orientation): Promise<void> {
    const oldFocused = this.focused;
    const newSessionInfo = await this.bridge.send(IpcChannel.SessionCreateForPane, {
      shell: this.shell,
      cwd: this.cwd,
      cols: 80,
      rows: 24,
      tabId: this.tabId,
    }) as { id: string } | { error: string };
    if ('error' in newSessionInfo) {
      console.error('[split] create pane failed:', newSessionInfo.error);
      return;
    }
    const newSessionId = newSessionInfo.id as SessionId;

    // A6-I3: `oldFocused` may have left the tree while the create-pane request was in
    // flight (e.g. its pane was closed by closeFocusedPane() from elsewhere). Proceeding
    // anyway would replaceChild against a detached element (a no-op, since parentElement
    // is now null) and replaceInTree would fail to find `oldFocused` and fall back to
    // installing `branch` as a brand-new root that was never attached to the DOM,
    // corrupting the tree. Abandon the split and clean up the now-orphaned pane instead.
    const stillInTree = oldFocused === this.root || this.findParent(this.root, oldFocused) !== null;
    if (!stillInTree) {
      console.warn('[split] focused pane left the tree while creating its sibling; abandoning split');
      void this.bridge.send(IpcChannel.SessionClosePane, { sessionId: newSessionId });
      return;
    }

    const branchEl = document.createElement('div');
    branchEl.style.display = 'flex';
    branchEl.style.flexDirection = orientation === 'horizontal' ? 'row' : 'column';
    branchEl.style.width = '100%';
    branchEl.style.height = '100%';

    const newLeafEl = this.makePaneElement();
    const divider = document.createElement('div');
    divider.style.background = 'var(--border-2)';
    divider.style.flex = '0 0 4px';
    divider.style.cursor = orientation === 'horizontal' ? 'col-resize' : 'row-resize';

    oldFocused.el.parentElement?.replaceChild(branchEl, oldFocused.el);
    oldFocused.el.style.flex = '1 1 50%';
    newLeafEl.style.flex = '1 1 50%';
    branchEl.appendChild(oldFocused.el);
    branchEl.appendChild(divider);
    branchEl.appendChild(newLeafEl);

    const newHost = new TerminalHost({ container: newLeafEl, sessionId: newSessionId, bridge: this.bridge });
    const newLeaf: LeafNode = { kind: 'leaf', sessionId: newSessionId, host: newHost, el: newLeafEl };

    const branch: BranchNode = {
      kind: 'branch',
      orientation,
      ratio: 0.5,
      a: oldFocused,
      b: newLeaf,
      el: branchEl,
    };
    // Replace the old leaf in the tree with the new branch.
    this.root = this.replaceInTree(this.root, oldFocused, branch) ?? branch;

    this.wireDivider(branch, divider);

    this.focused = newLeaf;
    newLeafEl.addEventListener('focusin', () => {
      this.focused = this.findLeafByElement(newLeafEl) ?? this.focused;
    });
    this.persist();
  }

  private wireDivider(branch: BranchNode, divider: HTMLElement): void {
    // Document-level move/up listeners exist only for the duration of a drag, so they
    // do not accumulate as more dividers are created.
    divider.addEventListener('mousedown', () => {
      const onMove = (ev: MouseEvent): void => {
        const rect = branch.el.getBoundingClientRect();
        const ratio = branch.orientation === 'horizontal'
          ? (ev.clientX - rect.left) / rect.width
          : (ev.clientY - rect.top) / rect.height;
        const clamped = Math.max(0.1, Math.min(0.9, ratio));
        branch.ratio = clamped;
        branch.a.el.style.flex = `1 1 ${clamped * 100}%`;
        branch.b.el.style.flex = `1 1 ${(1 - clamped) * 100}%`;
      };
      const onUp = (): void => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        this.persist();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  /** Close the focused pane and promote its sibling. No-op for a single-pane tab —
   * the tab-level close (Ctrl+W) handles that case. */
  closeFocusedPane(): void {
    if (this.root.kind === 'leaf') return;
    const target = this.focused;
    const parent = this.findParent(this.root, target);
    if (!parent) return;
    const sibling = parent.a === target ? parent.b : parent.a;

    // End the pane's session and tear down its terminal.
    target.host.dispose();
    void this.bridge.send(IpcChannel.SessionClosePane, { sessionId: target.sessionId });

    // Replace the parent branch with the sibling subtree, in the DOM and the tree.
    sibling.el.style.flex = '1 1 100%';
    parent.el.parentElement?.replaceChild(sibling.el, parent.el);
    if (this.root === parent) {
      this.root = sibling;
    } else {
      const grandparent = this.findParent(this.root, parent);
      if (grandparent) {
        if (grandparent.a === parent) grandparent.a = sibling;
        else grandparent.b = sibling;
      }
    }

    this.focused = this.firstLeaf(sibling);
    this.focused.el.focus();
    this.persist();
  }

  private findParent(node: SplitNode, target: SplitNode): BranchNode | null {
    if (node.kind === 'leaf') return null;
    if (node.a === target || node.b === target) return node;
    return this.findParent(node.a, target) ?? this.findParent(node.b, target);
  }

  private firstLeaf(node: SplitNode): LeafNode {
    return node.kind === 'leaf' ? node : this.firstLeaf(node.a);
  }

  private replaceInTree(node: SplitNode, target: SplitNode, replacement: SplitNode): SplitNode | null {
    if (node === target) return replacement;
    if (node.kind === 'leaf') return null;
    const a = this.replaceInTree(node.a, target, replacement);
    if (a) { node.a = a; return node; }
    const b = this.replaceInTree(node.b, target, replacement);
    if (b) { node.b = b; return node; }
    return null;
  }

  private makePaneElement(): HTMLElement {
    const el = document.createElement('div');
    el.style.flex = '1 1 100%';
    el.style.minWidth = '0';
    el.style.minHeight = '0';
    el.style.height = '100%';
    el.tabIndex = 0;
    this.wirePaneContextMenu(el);
    return el;
  }

  /** Right-click on a pane opens the themed context menu. The leaf is resolved
   * fresh from the DOM element on every event so it remains correct after
   * splits reshape the tree. */
  private wirePaneContextMenu(el: HTMLElement): void {
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const leaf = this.findLeafByElement(el);
      if (!leaf) return;
      const host = leaf.host;
      const inSplit = this.root.kind === 'branch';

      showContextMenu({
        x: e.clientX,
        y: e.clientY,
        // Restore keyboard focus to this pane's terminal after the menu closes —
        // for EVERY action and dismissal, so no item handler can forget it. Without
        // this, right-click → Copy/Paste/Select all left the xterm blurred (it renders
        // a hollow "box" cursor when unfocused) and the user had to click the pane to
        // type again. showContextMenu() runs onClose BEFORE the item's onClick (see
        // activate() in context-menu.ts), so this fires first and the sync/async action
        // then keeps or reassigns focus as needed — Split/Close deliberately re-target
        // focus to the new/sibling pane in their own handlers.
        onClose: () => host.focus(),
        items: buildTerminalContextMenu({
          hasSelection: host.hasSelection(),
          inSplit,
          platform: ACCELERATOR_PLATFORM,
          onCopy: () => {
            void navigator.clipboard.writeText(host.getSelection());
          },
          onPaste: async () => {
            const text = await navigator.clipboard.readText();
            host.paste(text);
          },
          onSelectAll: () => host.selectAll(),
          onSplitRight: () => { host.focus(); void this.splitFocused('horizontal'); },
          onSplitBelow: () => { host.focus(); void this.splitFocused('vertical'); },
          onClosePane:  () => { host.focus(); this.closeFocusedPane(); },
        }),
      });
    });
  }

  private findLeafByElement(el: HTMLElement): LeafNode | null {
    function walk(node: SplitNode): LeafNode | null {
      if (node.kind === 'leaf') return node.el === el ? node : null;
      return walk(node.a) ?? walk(node.b);
    }
    return walk(this.root);
  }

  getFocusedSessionId(): SessionId {
    return this.focused.sessionId;
  }

  /** Main promoted a sibling pane to be this tab's new primary/tabId after the
   * original primary pane closed. Future pane creates + persist calls must use the
   * new id (see event.layout.tab-reparented). */
  retarget(newTabId: SessionId): void {
    this.tabId = newTabId;
    // The tree shape was already corrected (pane removed/promoted) before main sent
    // the reparent event; that persist landed under the old tabId and was dropped
    // there (main deleted that entry). Re-send it under the new id (N1).
    this.persist();
  }

  private serializeNode(node: SplitNode): PersistedSplitNode {
    if (node.kind === 'leaf') return { kind: 'leaf' };
    return {
      kind: 'branch',
      orientation: node.orientation,
      ratio: node.ratio,
      a: this.serializeNode(node.a),
      b: this.serializeNode(node.b),
    };
  }

  serialize(): PersistedSplitNode | undefined {
    return this.root.kind === 'leaf' ? undefined : this.serializeNode(this.root);
  }

  private persist(): void {
    if (this.restoring) return;
    void this.bridge.send(IpcChannel.LayoutPersistSplits, {
      tabId: this.tabId,
      splits: this.serialize() ?? null,
    });
  }

  /**
   * Replay a saved tree onto the current single-leaf root by re-driving splitFocused().
   * If any pane create fails, that subtree is abandoned and the rest of the tree
   * still restores (the live tree stays coherent — just smaller than the saved one).
   */
  async restore(tree: PersistedSplitNode): Promise<void> {
    if (tree.kind === 'leaf') return;
    this.restoring = true;
    try {
      await this.restoreBranch(this.root as LeafNode, tree);
    } finally {
      this.restoring = false;
    }
  }

  /**
   * Restore `branch` underneath `target`. After splitFocused, the live branch has
   * `a` = original target (the existing leaf) and `b` = the newly created leaf.
   * We then recurse into both sides if they are themselves branches.
   */
  private async restoreBranch(target: LeafNode, branch: Extract<PersistedSplitNode, { kind: 'branch' }>): Promise<void> {
    // Focus the target leaf so splitFocused() splits the right pane.
    this.focused = target;
    await this.splitFocused(branch.orientation);

    // splitFocused leaves this.focused untouched on failure (early return) and sets it
    // to the newly created leaf on success. That is our reliable success signal — it
    // works at the top-level call AND in recursive calls, unlike findParent (target
    // already has a parent in the recursive case, so findParent would return the wrong
    // branch instead of null).
    if (this.focused === target) return;

    // After a successful split, target is now the `a` side of a fresh branch. Locate
    // that branch in the tree so we can apply the saved ratio.
    const newBranch = this.findParent(this.root, target);
    if (!newBranch) return; // defensive — should not happen after a confirmed success.

    // Apply the saved ratio.
    newBranch.ratio = branch.ratio;
    newBranch.a.el.style.flex = `1 1 ${branch.ratio * 100}%`;
    newBranch.b.el.style.flex = `1 1 ${(1 - branch.ratio) * 100}%`;

    // Recurse into a then b. Each side is a leaf at this point (splitFocused
    // creates a leaf for the new pane and keeps the old leaf intact).
    if (branch.a.kind === 'branch') {
      await this.restoreBranch(newBranch.a as LeafNode, branch.a);
    }
    if (branch.b.kind === 'branch') {
      await this.restoreBranch(newBranch.b as LeafNode, branch.b);
    }
  }

  /**
   * Called once during terminal mount: asks main for the saved split tree for this
   * tab and replays it. No-op if main returns null/no tree.
   */
  async loadSavedLayout(): Promise<void> {
    let saved: PersistedSplitNode | null | { error: string };
    try {
      saved = (await this.bridge.send(IpcChannel.LayoutSplitsForTab, {
        tabId: this.tabId,
      })) as PersistedSplitNode | null | { error: string };
    } catch (err) {
      console.warn('[split] could not fetch saved layout:', err);
      return;
    }
    if (!saved) return;
    if (typeof saved === 'object' && 'error' in saved) {
      console.warn('[split] main rejected splits-for-tab:', saved.error);
      return;
    }
    await this.restore(saved);
  }
}
