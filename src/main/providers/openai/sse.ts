import { ContractError } from '../../../shared/contracts/errors';

const MAX_EVENT_BYTES = 1024 * 1024;

async function read(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal) {
  if (signal.aborted) throw new ContractError('cancelled');
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new ContractError('cancelled'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([reader.read(), cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

export async function* readSse(response: Response, signal: AbortSignal, checkDeadline: () => void = () => {}): AsyncIterable<string> {
  if (!response.body || response.body.locked || response.bodyUsed) throw new ContractError('invalid_response');
  const reader = response.body.getReader();
  try {
    if (signal.aborted) throw new ContractError('cancelled');
    if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/event-stream') {
      throw new ContractError('invalid_response');
    }
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    let line = new Uint8Array(1024);
    let lineLength = 0;
    let eventBytes = 0;
    let skipLf = false;
    let firstLine = true;
    let frameOpen = false;
    let data: string[] = [];

    const finishLine = (): string | undefined => {
      let text: string;
      try { text = decoder.decode(line.subarray(0, lineLength)); }
      catch { throw new ContractError('invalid_response'); }
      lineLength = 0;
      if (firstLine) { firstLine = false; if (text.startsWith('\ufeff')) text = text.slice(1); }
      if (text === '') {
        const payload = data.length ? data.join('\n') : undefined;
        data = []; eventBytes = 0; frameOpen = false;
        return payload;
      }
      if (text.startsWith(':')) return;
      frameOpen = true;
      const colon = text.indexOf(':');
      const field = colon < 0 ? text : text.slice(0, colon);
      let value = colon < 0 ? '' : text.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      if (field === 'event' && value !== '' && value !== 'message') throw new ContractError('invalid_response');
    };

    while (true) {
      checkDeadline();
      const chunk = await read(reader, signal);
      if (signal.aborted) throw new ContractError('cancelled');
      if (chunk.done) break;
      for (const byte of chunk.value) {
        if (skipLf) { skipLf = false; if (byte === 10) continue; }
        if (++eventBytes > MAX_EVENT_BYTES) throw new ContractError('invalid_response');
        if (byte === 10 || byte === 13) {
          checkDeadline();
          skipLf = byte === 13;
          const payload = finishLine();
          if (payload !== undefined) {
            yield payload;
            if (signal.aborted) throw new ContractError('cancelled');
          }
        } else {
          if (lineLength === line.length) {
            const larger = new Uint8Array(Math.min(line.length * 2, MAX_EVENT_BYTES));
            larger.set(line); line = larger;
          }
          line[lineLength++] = byte;
        }
      }
    }
    if (lineLength || frameOpen) throw new ContractError('invalid_response');
  } catch (error) {
    if (signal.aborted) throw new ContractError('cancelled');
    throw error instanceof ContractError ? error : new ContractError('network_error');
  } finally {
    // A transport's cancel promise may stall; releasing our reader must not wait for it.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
