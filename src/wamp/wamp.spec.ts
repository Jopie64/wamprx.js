import { Observable, Subject, of, concat, never } from 'rxjs';
import { WampWebSocket, connectWampChannel, WampChannel } from './wamp';

describe('wamp', () => {

    const makeMockWebSocket = (receive$: Observable<string>): WampWebSocket =>({
        send: () => {},
        receive$
    });

    const connectMockWebSocket = (webSocket$: Observable<WampWebSocket>) => (url: string, protocol: string): Observable<WampWebSocket> => webSocket$;

    const handleQueuedEvents = () => new Promise(resolve => setTimeout(resolve, 0));

    it('logs in when you start using it', async () => {
        const receive$ = new Subject<string>();
        const mockWebSocket = makeMockWebSocket(receive$);
        spyOn(mockWebSocket, 'send');
        const connectWebSocket = connectMockWebSocket(concat(of(mockWebSocket), never()));

        const channel$ = connectWampChannel('fakeurl', 'fakeProtocol', undefined, connectWebSocket);

        expect(mockWebSocket.send).toHaveBeenCalledTimes(0);

        let channel: WampChannel | null = null;
        channel$.subscribe(newChannel => channel = newChannel);
        await handleQueuedEvents();

        expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
        expect(channel).toBeFalsy();

        // Receive welcome
        receive$.next('[2, 123, {}]');
        await handleQueuedEvents();

        expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
        expect(channel).toBeTruthy();
    });
});