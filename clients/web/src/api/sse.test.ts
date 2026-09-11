import { afterEach, expect, it, vi } from 'vitest';
import { DaemonEventSource } from './sse';

class EventPort extends EventTarget {
  static last: EventPort;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { super(); EventPort.last = this; }
  close() {}
  emit() { this.dispatchEvent(new MessageEvent('update', { data: '{"value":1}', lastEventId: 'epoch:42' })); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('keeps one delivery per live subscriber through dynamic subscriptions and reconnect', () => {
  vi.stubGlobal('EventSource', EventPort);
  const source = new DaemonEventSource();
  const first = vi.fn(), second = vi.fn();
  const offFirst = source.on('update', first);
  source.connect();
  const offSecond = source.on('update', second);
  EventPort.last.emit();
  expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
  offFirst(); EventPort.last.emit();
  expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(2);
  offSecond(); EventPort.last.emit(); expect(second).toHaveBeenCalledTimes(2);
  source.on('update', first); source.disconnect(); source.connect(); EventPort.last.emit();
  expect(first).toHaveBeenCalledTimes(2);
  expect(EventPort.last.url).toContain("after=epoch%3A42");
  source.disconnect();
});

it('cancels retry when the status callback disconnects the source', () => {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', EventPort);
  const source = new DaemonEventSource({ onStatusChange: status => {
    if (status === 'reconnecting') source.disconnect();
  } });
  source.connect();
  const original = EventPort.last;
  original.onerror?.();
  vi.runAllTimers();
  expect(EventPort.last).toBe(original);
  source.disconnect();
});

it.each(['null', '[]', '42'])('rejects malformed event payload %s before delivery', raw => {
  vi.stubGlobal('EventSource', EventPort);
  const onMalformedEvent = vi.fn(), receive = vi.fn();
  const source = new DaemonEventSource({ onMalformedEvent });
  source.on('update', receive); source.connect();
  EventPort.last.dispatchEvent(new MessageEvent('update', { data: raw }));
  expect(receive).not.toHaveBeenCalled();
  expect(onMalformedEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'update', raw }));
  source.disconnect();
});
