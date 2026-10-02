/**
 * Play Integrity API (Android) — interface-first scaffold (AGENTS.md task:
 * "เปิดทาง Play Integrity API ไว้ ใส่เป็น interface ก่อน ยังไม่ต้องต่อของจริง").
 *
 * The app talks only to this interface. A real implementation backed by a
 * native module (dev build / prebuild — not Expo Go) can be registered later
 * via {@link setPlayIntegrityProvider} without touching call sites.
 * TESTNET ONLY — no production attestation policy is defined here.
 */

export interface PlayIntegrityAttestation {
  /** Opaque integrity token to forward to the Nexus backend (TESTNET). */
  token: string;
  /** Epoch milliseconds when the token was requested. */
  requestTimeMs: number;
}

export interface PlayIntegrityProvider {
  /** Whether a real native implementation is currently registered. */
  readonly isAvailable: boolean;
  /**
   * Requests an integrity verdict for this device.
   *
   * @param nonce - Optional server-provided nonce to bind the token to.
   */
  requestIntegrityToken(nonce?: string): Promise<PlayIntegrityAttestation>;
}

/** Thrown by the placeholder while no native implementation is connected. */
export class PlayIntegrityNotConnectedError extends Error {
  public constructor() {
    super('Play Integrity provider is not connected yet');
    this.name = 'PlayIntegrityNotConnectedError';
  }
}

/** Default provider — keeps the path open without faking any device verdict. */
export const placeholderPlayIntegrityProvider: PlayIntegrityProvider = {
  isAvailable: false,
  async requestIntegrityToken(): Promise<PlayIntegrityAttestation> {
    throw new PlayIntegrityNotConnectedError();
  },
};

let activeProvider: PlayIntegrityProvider = placeholderPlayIntegrityProvider;

/** Registers a real implementation (future native module wiring). */
export function setPlayIntegrityProvider(provider: PlayIntegrityProvider): void {
  activeProvider = provider;
}

/** Returns the currently registered provider. */
export function getPlayIntegrityProvider(): PlayIntegrityProvider {
  return activeProvider;
}
