import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, randomActionId, sha256Hex } from './hash.js';
import type { AdminAction, AdminQuestionInput, ChainAnswerKey } from './types.js';

export interface AdminConfig {
  /** Admin username (default `admin`). */
  readonly username?: string;
  /** Admin password. Only its scrypt hash is persisted. */
  readonly password: string;
  /** Directory for admin state (hashed credential + session store). */
  readonly dataDir: string;
}

export interface AdminSession {
  readonly token: string;
  readonly username: string;
  readonly expiresAt: number;
}

interface StoredCredential {
  username: string;
  saltHex: string;
  hashHex: string;
}

/**
 * Admin console backing the owner's back-office: log in, then add or change
 * answers for any question. Mutations are returned as on-chain action
 * records that the chain embeds into the next mined block — the chain is
 * the single source of truth for answer state (no parallel override file).
 */
export class AdminConsole {
  readonly #username: string;
  readonly #password: string;
  readonly #dataDir: string;
  readonly #sessionTtlMs: number;
  readonly #sessions = new Map<string, AdminSession>();

  constructor(config: AdminConfig, sessionTtlMs = 12 * 60 * 60 * 1000) {
    this.#username = config.username ?? 'admin';
    this.#password = config.password;
    this.#dataDir = config.dataDir;
    this.#sessionTtlMs = sessionTtlMs;
  }

  #credentialPath(): string {
    return path.join(this.#dataDir, 'admin-credential.json');
  }

  #sessionsPath(): string {
    return path.join(this.#dataDir, 'admin-sessions.json');
  }

  async #ensureDir(): Promise<void> {
    await mkdir(this.#dataDir, { recursive: true });
  }

  /** Writes the scrypt-hashed credential (first run or password change). */
  async setPassword(password: string): Promise<void> {
    await this.#ensureDir();
    const salt = randomBytes(16);
    const stored: StoredCredential = {
      username: this.#username,
      saltHex: salt.toString('hex'),
      hashHex: scryptSync(password, salt, 64).toString('hex'),
    };
    await writeFile(this.#credentialPath(), canonicalJson(stored), { encoding: 'utf8', mode: 0o600 });
  }

  /**
   * Ensures a credential exists on disk (creating it from the configured
   * password on first run) and restores still-valid sessions.
   */
  async initialize(): Promise<void> {
    await this.#ensureDir();
    let stored: StoredCredential | null = null;
    try {
      stored = JSON.parse(await readFile(this.#credentialPath(), 'utf8')) as StoredCredential;
    } catch {
      stored = null;
    }
    if (!stored) {
      await this.setPassword(this.#password);
    }
    try {
      const raw = JSON.parse(await readFile(this.#sessionsPath(), 'utf8')) as AdminSession[];
      const now = Date.now();
      for (const session of raw) {
        if (session.expiresAt > now) this.#sessions.set(session.token, session);
      }
    } catch {
      // no sessions yet
    }
  }

  /** Verifies credentials and issues a session token. */
  async login(username: string, password: string): Promise<AdminSession> {
    const stored = await this.#readCredential();
    if (!stored || stored.username !== username) throw new Error('INVALID_CREDENTIALS');
    const salt = Buffer.from(stored.saltHex, 'hex');
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(stored.hashHex, 'hex');
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      throw new Error('INVALID_CREDENTIALS');
    }
    const session: AdminSession = {
      token: sha256Hex(`${randomBytes(32).toString('hex')}:${Date.now()}`),
      username,
      expiresAt: Date.now() + this.#sessionTtlMs,
    };
    this.#sessions.set(session.token, session);
    await this.#persistSessions();
    return session;
  }

  async #readCredential(): Promise<StoredCredential | null> {
    try {
      return JSON.parse(await readFile(this.#credentialPath(), 'utf8')) as StoredCredential;
    } catch {
      return null;
    }
  }

  /** Throws when the token is missing/expired. */
  requireSession(token: string | undefined | null): AdminSession {
    if (!token) throw new Error('UNAUTHORIZED');
    const session = this.#sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      this.#sessions.delete(token ?? '');
      throw new Error('UNAUTHORIZED');
    }
    return session;
  }

  /** Ends a session. */
  async logout(token: string): Promise<void> {
    this.#sessions.delete(token);
    await this.#persistSessions();
  }

  /**
   * Sets/changes the accepted answer for a question (the "เพิ่มคำตอบ" /
   * "เปลี่ยนคำตอบ" case). Returns the on-chain action for the next block.
   */
  async editAnswer(sessionToken: string, questionId: string, answerIndex: number, alternatives: readonly number[] = []): Promise<AdminAction> {
    this.requireSession(sessionToken);
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) throw new Error('INVALID_ANSWER_INDEX');
    for (const alt of alternatives) {
      if (!Number.isInteger(alt) || alt < 0 || alt > 3) throw new Error('INVALID_ALTERNATIVE');
    }
    const session = this.requireSession(sessionToken);
    const key: ChainAnswerKey = { answerIndex, alternatives: [...alternatives] };
    const action: AdminAction = {
      id: randomActionId(),
      kind: 'EDIT_ANSWER',
      questionId,
      oldAnswer: null,
      newAnswer: key,
      newQuestion: null,
      by: session.username,
      at: Math.floor(Date.now() / 1000),
      actionHash: sha256Hex(canonicalJson({ questionId, key, by: session.username })),
    };
    return action;
  }

  /**
   * Adds a brand-new admin-authored question (answers included in the hash).
   * Returns the on-chain action for the next block.
   */
  async addQuestion(sessionToken: string, input: AdminQuestionInput): Promise<AdminAction> {
    this.requireSession(sessionToken);
    if (!input.prompt?.th?.trim() || !input.prompt?.en?.trim()) throw new Error('INVALID_PROMPT');
    if (input.options.length !== 4) throw new Error('INVALID_OPTIONS');
    if (!Number.isInteger(input.answerIndex) || input.answerIndex < 0 || input.answerIndex > 3) throw new Error('INVALID_ANSWER_INDEX');
    if (!DISCIPLINE_IDS_SET.has(input.discipline)) throw new Error('UNKNOWN_DISCIPLINE');
    const session = this.requireSession(sessionToken);
    const action: AdminAction = {
      id: randomActionId(),
      kind: 'ADD_QUESTION',
      questionId: `admin-${sha256Hex(canonicalJson(input)).slice(2, 10)}`,
      oldAnswer: null,
      newAnswer: { answerIndex: input.answerIndex, alternatives: [...(input.alternatives ?? [])] },
      newQuestion: input,
      by: session.username,
      at: Math.floor(Date.now() / 1000),
      actionHash: sha256Hex(canonicalJson(input)),
    };
    return action;
  }

  /** Latest accepted key for a question from the given committed actions. */
  static latestKeyFor(actions: readonly AdminAction[], questionId: string): ChainAnswerKey | null {
    let latest: ChainAnswerKey | null = null;
    for (const action of actions) {
      if (action.kind === 'EDIT_ANSWER' && action.questionId === questionId && action.newAnswer) latest = action.newAnswer;
    }
    return latest;
  }

  async #persistSessions(): Promise<void> {
    await this.#ensureDir();
    const raw = [...this.#sessions.values()];
    await writeFile(this.#sessionsPath(), canonicalJson(raw), { encoding: 'utf8', mode: 0o600 });
  }
}

const DISCIPLINE_IDS_SET: ReadonlySet<string> = new Set([
  'math', 'science', 'thai', 'english', 'social', 'health',
  'art', 'career', 'ict', 'econ', 'geography', 'philosophy',
]);
