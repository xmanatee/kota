import { DaemonClient } from '../daemonClient';

class StreamPort {
  static HEADERS_RECEIVED = 2; static LOADING = 3; static DONE = 4;
  static last: StreamPort;
  readyState = 0; status = 200; responseText = ''; url = ''; body: unknown; aborted = false;
  headers: Record<string, string> = {};
  onreadystatechange = () => {}; onerror = () => {}; ontimeout = () => {};
  constructor() { StreamPort.last = this; }
  open(_method: string, url: string) { this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body: unknown) { this.body = body; }
  abort() { this.aborted = true; this.readyState = 4; this.onreadystatechange(); }
  receive(chunk: string, done = false) {
    this.responseText += chunk; this.readyState = done ? 4 : 3; this.onreadystatechange();
  }
}
const original = globalThis.XMLHttpRequest;
beforeEach(() => { globalThis.XMLHttpRequest = StreamPort as unknown as typeof XMLHttpRequest; });
afterEach(() => { globalThis.XMLHttpRequest = original; jest.useRealTimers(); });

it('delivers chat once at every possible frame split and owns authentication', () => {
  const wire = 'event:text\r\ndata: {"content":"hello"}\r\n\r\nevent:done\ndata: {}\n\n';
  for (let split = 0; split <= wire.length; split++) {
    const text = jest.fn(), done = jest.fn(), error = jest.fn();
    new DaemonClient('http://daemon', 'token').streamChat('session/one', 'Hi', text, done, error);
    const xhr = StreamPort.last;
    xhr.receive(wire.slice(0, split)); xhr.receive(wire.slice(split), true);
    expect(text.mock.calls).toEqual([['hello']]); expect(done).toHaveBeenCalledTimes(1); expect(error).not.toHaveBeenCalled();
    expect(xhr.url).toBe('http://daemon/sessions/session%2Fone/chat');
    expect(xhr.headers.Authorization).toBe('Bearer token');
  }
});

it.each(['data: {bad}\n\n', 'event:text\ndata:{"content":"unfinished'])('surfaces malformed or incomplete chat: %s', wire => {
  const done = jest.fn(), error = jest.fn();
  new DaemonClient('http://daemon', 'token').streamChat('s', 'Hi', jest.fn(), done, error);
  StreamPort.last.receive(wire, true);
  expect(error).toHaveBeenCalledTimes(1); expect(done).not.toHaveBeenCalled();
});

it('aborts a failed chat without reporting success or delivering later text', () => {
  const text = jest.fn(), done = jest.fn(), error = jest.fn();
  new DaemonClient('http://daemon', 'token').streamChat('s', 'Hi', text, done, error);
  const xhr = StreamPort.last;
  xhr.receive('event:error\ndata:{"message":"Session unavailable"}\n\n');
  expect(xhr.aborted).toBe(true);
  xhr.receive('event:text\ndata:{"content":"late"}\n\nevent:done\ndata:{}\n\n', true);
  expect(error.mock.calls).toEqual([['Session unavailable']]);
  expect(text).not.toHaveBeenCalled(); expect(done).not.toHaveBeenCalled();
});

it('stops reconnection and event delivery when the subscription closes', () => {
  jest.useFakeTimers();
  const onEvent = jest.fn(), onStatus = jest.fn();
  const stop = new DaemonClient('http://daemon', 'token').subscribeEvents({ onEvent, onStatus });
  const xhr = StreamPort.last;
  xhr.receive('event: update\ndata: {"value":'); xhr.receive('1}\n\n');
  expect(onEvent).toHaveBeenCalledWith({ type: 'update', payload: { value: 1 } });
  xhr.onerror(); stop(); jest.runAllTimers();
  expect(StreamPort.last).toBe(xhr);
  xhr.receive('event:update\ndata:{}\n\n'); expect(onEvent).toHaveBeenCalledTimes(1);
});

it('resumes the event stream using the daemon event id', () => {
  jest.useFakeTimers();
  const client = new DaemonClient('http://daemon', 'token');
  const stop = client.subscribeEvents({ onEvent: jest.fn(), onStatus: jest.fn() });
  StreamPort.last.receive('id: epoch:42\nevent: task.changed\ndata: {}\n\n', true);
  jest.advanceTimersByTime(1000);
  expect(StreamPort.last.url).toBe('http://daemon/events?after=epoch%3A42');
  stop();
});
