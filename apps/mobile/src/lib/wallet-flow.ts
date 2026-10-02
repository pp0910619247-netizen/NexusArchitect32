/**
 * Wallet save flow (AGENTS.md §6): a saved address is permanent and may only
 * be replaced after two explicit confirmations.
 *
 * Pure decision helper so the two-step confirmation rule is unit-testable.
 */
export type WalletSaveStep =
  /** Write directly: nothing saved yet, or the value is unchanged. */
  | 'write'
  /** First of two required overwrite confirmations. */
  | 'confirm1';

/**
 * @param current - The permanently stored address, or `null` when none.
 * @param next - The canonical (EIP-55 normalized) address the user entered.
 */
export function nextWalletSaveStep(current: string | null, next: string): WalletSaveStep {
  if (current === null) {
    return 'write';
  }
  if (current.toLowerCase() === next.toLowerCase()) {
    return 'write';
  }
  return 'confirm1';
}
