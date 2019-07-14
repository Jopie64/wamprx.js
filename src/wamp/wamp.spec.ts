import { Observable, Subject, of, concat, never } from 'rxjs';
import { WampWebSocket, connectWampChannel, WampChannel, createWampChannelFromWs, makeNullLogger } from './wamp';
import { toArray } from 'rxjs/operators';

describe('wamp', () => {

    const makeMockWebSocket = (receive$: Observable<string>): WampWebSocket =>({
        send: () => {},
        receive$
    });

    const connectMockWebSocket = (webSocket$: Observable<WampWebSocket>) => (url: string, protocol: string): Observable<WampWebSocket> => webSocket$;

    const handleQueuedEvents = () => new Promise(resolve => setTimeout(resolve, 0));

    const prepareWampChannel = async () => {
        const receive$ = new Subject<string>();
        const mockWebSocket = makeMockWebSocket(receive$);
        spyOn(mockWebSocket, 'send');
        const channel = createWampChannelFromWs(mockWebSocket, makeNullLogger, 100);

        return { channel, mockWebSocket, receive$ };
    }

    it('does basic login flow correctly', async () => {

        const receive$ = new Subject<string>();
        const mockWebSocket = makeMockWebSocket(receive$);
        spyOn(mockWebSocket, 'send');
        const connectWebSocket = connectMockWebSocket(concat(of(mockWebSocket), never()));

        const channel$ = connectWampChannel('fakeurl', 'fakeRealm', undefined, connectWebSocket);

        expect(mockWebSocket.send).toHaveBeenCalledTimes(0);

        let channel: WampChannel | null = null;
        channel$.subscribe(newChannel => channel = newChannel);
        await handleQueuedEvents();

        expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
        expect(mockWebSocket.send).toHaveBeenCalledWith('[1,"fakeRealm",{"roles":{"caller":{"features":{"progressive_call_results":true,"call_canceling":true}}}}]');
        expect(channel).toBeFalsy();

        // Receive welcome
        receive$.next('[2, 123, {}]');
        await handleQueuedEvents();

        expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
        expect(channel).toBeTruthy();
    });

    describe("RPC", () => {

        it('works with simple call-response', async () => {
            const { channel, mockWebSocket, receive$ } = await prepareWampChannel();

            const callThing$ = channel.call('thing', ['I\'m calling you']);
            expect(mockWebSocket.send).toHaveBeenCalledTimes(0);

            let result: any[] = [];
            callThing$.pipe(toArray()).subscribe(it => result = it);
            expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
            expect(mockWebSocket.send).toHaveBeenCalledWith('[48,101,{"receive_progress":true},"thing",["I\'m calling you"]]');
            expect(result).toEqual([]);

            receive$.next('[50,101,{},["I hear you!"]]');
            await handleQueuedEvents();
            expect(result).toEqual([[['I hear you!']]]);
        });

        it('handles progressive responses', async () => {
            const { channel, mockWebSocket, receive$ } = await prepareWampChannel();

            const callThing$ = channel.call('thing', ['I\'m calling you']);
            expect(mockWebSocket.send).toHaveBeenCalledTimes(0);

            let result: any[] = [];
            callThing$.pipe(toArray()).subscribe(it => result = it);
            expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
            expect(mockWebSocket.send).toHaveBeenCalledWith('[48,101,{"receive_progress":true},"thing",["I\'m calling you"]]');
            expect(result).toEqual([]);

            receive$.next('[50,101,{"progress":true},["Let me process that..."]]');
            await handleQueuedEvents();
            expect(result).toEqual([]);

            receive$.next('[50,101,{"progress":true},[1]]');
            receive$.next('[50,101,{"progress":true},[2]]');
            receive$.next('[50,101,{"progress":true},[3]]');
            receive$.next('[50,101,{},["Done!"]]');
            await handleQueuedEvents();
            expect(result).toEqual([[['Let me process that...']], [[1]], [[2]], [[3]], [['Done!']]]);
        });

        it('will cancel a call', async () => {
            const { channel, mockWebSocket, receive$ } = await prepareWampChannel();

            const callThing$ = channel.call('thing', ['I\'m calling you']);
            expect(mockWebSocket.send).toHaveBeenCalledTimes(0);

            let result: any[] = [];
            const subscription = callThing$.pipe(toArray()).subscribe(it => result = it);
            expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
            expect(mockWebSocket.send).toHaveBeenCalledWith('[48,101,{"receive_progress":true},"thing",["I\'m calling you"]]');
            expect(result).toEqual([]);

            subscription.unsubscribe();
            expect(mockWebSocket.send).toHaveBeenCalledTimes(2);
            expect(mockWebSocket.send).toHaveBeenCalledWith('[49,101,{"mode":"kill"}]');
        });

        it('handles error responses', async () => {
            const { channel, mockWebSocket, receive$ } = await prepareWampChannel();

            const callThing$ = channel.call('thing', ['I\'m calling you']);
            expect(mockWebSocket.send).toHaveBeenCalledTimes(0);

            let result: any[] = [];
            let error: any = null;
            callThing$.pipe(toArray()).subscribe(
                it => result = it,
                e => error = e);
            expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
            expect(mockWebSocket.send).toHaveBeenCalledWith('[48,101,{"receive_progress":true},"thing",["I\'m calling you"]]');
            expect(result).toEqual([]);

            // Error!
            receive$.next('[8,48,101,{},"wamp.something.invalid",["Some error has occurd!"]]');
            await handleQueuedEvents();
            expect(result).toEqual([]);
            expect(error).toEqual([{}, 'wamp.something.invalid', [ 'Some error has occurd!' ]]);
        });

        it('separates simultaneous calls', async () => {
            const { channel, mockWebSocket, receive$ } = await prepareWampChannel();

            const callThing$ = channel.call('thing', ['I\'m calling you', 'twice']);
            expect(mockWebSocket.send).toHaveBeenCalledTimes(0);

            let result1: any[] = [];
            callThing$.pipe(toArray()).subscribe(it => result1 = it);
            expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
            expect(mockWebSocket.send).toHaveBeenCalledWith('[48,101,{"receive_progress":true},"thing",["I\'m calling you","twice"]]');
            expect(result1).toEqual([]);

            let result2: any[] = [];
            callThing$.pipe(toArray()).subscribe(it => result2 = it);
            expect(mockWebSocket.send).toHaveBeenCalledTimes(2);
            expect(mockWebSocket.send).toHaveBeenCalledWith('[48,102,{"receive_progress":true},"thing",["I\'m calling you","twice"]]');

            expect(result2).toEqual([]);

            receive$.next('[50,101,{"progress":true},["I hear you!"]]');
            receive$.next('[50,102,{"progress":true},["I hear you", "too!"]]');
            receive$.next('[50,101,{},["end1"]]');
            receive$.next('[50,102,{},["end2"]]');
            await handleQueuedEvents();

            expect(result1).toEqual([[['I hear you!']], [["end1"]]]);
            expect(result2).toEqual([[['I hear you', 'too!']], [["end2"]]]);
        });
    });
});