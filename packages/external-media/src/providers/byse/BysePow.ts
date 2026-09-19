/**
 * Byse's client-side proof-of-work player check.
 *
 * Ported bit-for-bit from the client bundle's own hash routine (a
 * ChaCha-quarter-round-based scratch mix, not a standard hash like SHA-256)
 * — the server's difficulty check re-derives the exact same value from the
 * exact same input, so any deviation here just produces a solution the
 * server rejects. This is CPU-bound only: no browser APIs, no network.
 */

const POW_WORDS = 512;
const POW_MASK = POW_WORDS - 1;
const POW_ROUNDS = 2;
const POW_MIX_A = 2654435761;
const POW_MIX_B = 2246822519;

function rotl32(value: number, amount: number): number {
  return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

function mul32(a: number, b: number): number {
  return Math.imul(a, b) >>> 0;
}

function quarterRound(state: Uint32Array): void {
  state[0] = (state[0]! + state[1]!) >>> 0;
  state[3] = rotl32(state[3]! ^ state[0]!, 16);
  state[2] = (state[2]! + state[3]!) >>> 0;
  state[1] = rotl32(state[1]! ^ state[2]!, 12);
  state[0] = (state[0]! + state[1]!) >>> 0;
  state[3] = rotl32(state[3]! ^ state[0]!, 8);
  state[2] = (state[2]! + state[3]!) >>> 0;
  state[1] = rotl32(state[1]! ^ state[2]!, 7);
}

function powHash(input: Uint8Array): Uint32Array {
  const state = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762]);

  for (let i = 0; i < input.length; i += 1) {
    state[0] = (state[0]! + input[i]!) >>> 0;
    state[0] = rotl32(state[0]!, 7);
    quarterRound(state);
  }

  for (let i = 0; i < 8; i += 1) quarterRound(state);

  const scratch = new Uint32Array(POW_WORDS);
  for (let i = 0; i < POW_WORDS; i += 1) {
    quarterRound(state);
    scratch[i] = (state[0]! ^ state[2]!) >>> 0;
  }

  for (let round = 0; round < POW_ROUNDS; round += 1) {
    for (let i = 0; i < POW_WORDS; i += 1) {
      const index = scratch[i]! & POW_MASK;
      let value = (scratch[i]! + scratch[index]!) >>> 0;
      value = rotl32(value, 13);
      value = (value ^ mul32(scratch[(i + 1) & POW_MASK]!, POW_MIX_A)) >>> 0;
      scratch[i] = value;
      state[0] = (state[0]! ^ value) >>> 0;
      quarterRound(state);
    }
  }

  const output = new Uint32Array(8);
  const block = POW_WORDS / 8;

  for (let i = 0; i < 8; i += 1) {
    quarterRound(state);
    let value = state[0]!;
    const start = i * block;

    for (let j = 0; j < block; j += 1) {
      const item = scratch[start + j]!;
      value = (value + item) >>> 0;
      value = rotl32(value, 5);
      value = (value ^ mul32(item, POW_MIX_B)) >>> 0;
    }

    output[i] = (value ^ state[2]!) >>> 0;
  }

  return output;
}

function leadingZeroBits(words: Uint32Array): number {
  let count = 0;
  for (const word of words) {
    if (word === 0) {
      count += 32;
      continue;
    }
    return count + Math.clz32(word);
  }
  return count;
}

function latin1Bytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) bytes[i] = value.charCodeAt(i) & 0xff;
  return bytes;
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Finds a `solution` such that `powHash(\`${nonce}:${solution}\`)` has at
 * least `difficulty` leading zero bits. Yields to the event loop between
 * batches so this never blocks the process for its full timeout budget —
 * important since this runs inside the API server, not a browser tab.
 * Returns `null` on timeout rather than throwing, since a timeout is an
 * expected/ordinary outcome the caller decides how to handle (fall back to
 * iframe), not a defect.
 */
export async function solveBysePow(
  nonce: string,
  difficulty: number,
  timeoutMs = 20_000,
  signal?: AbortSignal,
): Promise<string | null> {
  if (difficulty <= 0) return '0';

  const prefix = `${nonce}:`;
  const startedAt = Date.now();
  let solution = 0;
  const batch = 1024;

  for (;;) {
    if (signal?.aborted === true) {
      throw new DOMException('PoW solving aborted', 'AbortError');
    }

    for (let i = 0; i < batch; i += 1) {
      const hash = powHash(latin1Bytes(prefix + String(solution)));
      if (leadingZeroBits(hash) >= difficulty) return String(solution);
      solution += 1;
    }

    if (Date.now() - startedAt > timeoutMs) return null;
    await yieldEventLoop();
  }
}
