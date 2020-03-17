import { Observable, Subject, of, concat, never, empty, Subscription } from 'rxjs';
import { WampWebSocket, connectWampChannel, WampChannel, createWampChannelFromWs,
    makeNullLogger, LoginAuth, ArgsAndDict, makeConsoleLogger } from './wamp';
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
        const makeLogger = makeNullLogger;
        // Uncomment this to enable logging
        // const makeLogger = makeConsoleLogger;
        const channelPromise = createWampChannelFromWs(mockWebSocket, 'fakeRealm', undefined, makeLogger, 100);
        receive$.next('[2, 123, {}]');
        await Promise.resolve();
        spyOn(mockWebSocket, 'send');

        const channel = await channelPromise;
        return { channel, mockWebSocket, receive$ };
    }

    describe("login", () => {
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
            expect(mockWebSocket.send).toHaveBeenCalledWith(
                '[1,"fakeRealm",{"roles":{' +
                '"caller":{"features":{"progressive_call_results":true,"call_canceling":true}},' +
                '"callee":{"features":{"progressive_call_results":true,"call_canceling":true}},' +
                '"subscriber":{},' +
                '"publisher":{}' +
                '}}]');
            expect(channel).toBeFalsy();

            // Receive welcome
            receive$.next('[2, 123, {}]');
            await handleQueuedEvents();

            expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
            expect(channel).toBeTruthy();
        });

        it('will not login when challenged and auth not provided', async () => {
            const receive$ = new Subject<string>();
            const mockWebSocket = makeMockWebSocket(receive$);
            const connectWebSocket = connectMockWebSocket(concat(of(mockWebSocket), never()));

            const channel$ = connectWampChannel('fakeurl', 'fakeRealm', undefined, connectWebSocket);

            let channel: WampChannel | null = null;
            let error: any = null;
            channel$.subscribe(
                newChannel => channel = newChannel,
                e => error = e);
            await handleQueuedEvents();

            // Receive challenge, but unexpected
            receive$.next('[4, "ticket", {}]');
            await handleQueuedEvents();

            expect(channel).toBeFalsy();
            expect(error).toEqual(new Error('Received unexpected challenge'));
        });

        it('does login flow with auth correctly', async () => {
            const receive$ = new Subject<string>();
            const mockWebSocket = makeMockWebSocket(receive$);
            spyOn(mockWebSocket, 'send');
            const connectWebSocket = connectMockWebSocket(concat(of(mockWebSocket), never()));

            const auth: LoginAuth = {
                authid: 'myId',
                authmethods: ['ticket'],
                challenge: () => 'some ticket'
            };
            spyOn(auth, 'challenge').and.returnValue('some ticket');

            const channel$ = connectWampChannel('fakeurl', 'fakeRealm', auth, connectWebSocket);

            expect(mockWebSocket.send).toHaveBeenCalledTimes(0);

            let channel: WampChannel | null = null;
            channel$.subscribe(newChannel => channel = newChannel);
            await handleQueuedEvents();

            expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
            expect(mockWebSocket.send).toHaveBeenCalledWith(
                '[1,"fakeRealm",{"roles":{' +
                    '"caller":{"features":{"progressive_call_results":true,"call_canceling":true}},' +
                    '"callee":{"features":{"progressive_call_results":true,"call_canceling":true}},' +
                    '"subscriber":{},' +
                    '"publisher":{}' +
                '},' +
                '"authid":"myId","authmethods":["ticket"]}]'
            );
            expect(channel).toBeFalsy();

            // Receive challenge
            receive$.next('[4, "ticket", {"somethingExtra": "extra value"}]');
            await handleQueuedEvents();
            expect(auth.challenge).toHaveBeenCalledTimes(1);
            expect(auth.challenge).toHaveBeenCalledWith('ticket', {somethingExtra: 'extra value'});
            expect(mockWebSocket.send).toHaveBeenCalledTimes(2);
            expect(mockWebSocket.send).toHaveBeenCalledWith('[5,"some ticket",{}]');

            // Receive welcome
            receive$.next('[2, 123, {}]');
            await handleQueuedEvents();

            expect(mockWebSocket.send).toHaveBeenCalledTimes(2);
            expect(channel).toBeTruthy();
        });
    });

    describe("RPC caller", () => {

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

        it('handles last message without payload as only a completion message', async () => {
            const { channel, mockWebSocket, receive$ } = await prepareWampChannel();

            const callThing$ = channel.call('thing', ['I\'m calling you']);
            expect(mockWebSocket.send).toHaveBeenCalledTimes(0);

            let result: any[] = [];
            callThing$.pipe(toArray()).subscribe(it => result = it);
            expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
            expect(mockWebSocket.send).toHaveBeenCalledWith('[48,101,{"receive_progress":true},"thing",["I\'m calling you"]]');
            expect(result).toEqual([]);

            receive$.next('[50,101,{"progress":true},[1]]');
            receive$.next('[50,101,{"progress":true},[2]]');
            receive$.next('[50,101,{"progress":true},[3]]');
            receive$.next('[50,101,{}]'); // No payload: a completion message
            await handleQueuedEvents();
            expect(result).toEqual([[[1]], [[2]], [[3]]]);
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

            // Call 1
            let result1: any[] = [];
            callThing$.pipe(toArray()).subscribe(it => result1 = it);
            expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
            expect(mockWebSocket.send).toHaveBeenCalledWith('[48,101,{"receive_progress":true},"thing",["I\'m calling you","twice"]]');
            expect(result1).toEqual([]);

            // Call 2
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

    describe("RPC callee", () => {
        it('registers a function', async () => {
            const { channel, mockWebSocket } = await prepareWampChannel();
            channel.register('my.function', () => empty());
            expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
            expect(mockWebSocket.send).toHaveBeenCalledWith('[64,101,{"receive_progress":true},"my.function"]');
        });

        it('succeeds at registering a function', async () => {
            const { channel, receive$ } = await prepareWampChannel();
            let subs: any;
            channel.register('my.function', () => empty()).then(it => subs = it);
            await Promise.resolve();
            expect(subs).toBeUndefined();
            receive$.next('[65,101,123]');
            await Promise.resolve();
            await Promise.resolve();
            expect(subs).toEqual(jasmine.any(Subscription));
        });

        it('fails at registering a function', async () => {
            const { channel, receive$ } = await prepareWampChannel();
            let error: any;
            channel.register('my.function', () => empty()).catch(it => error = it);
            await Promise.resolve();
            expect(error).toBeUndefined();
            receive$.next('[8,64,101,{},"wamp.error.procedure_already_exists"]');
            await Promise.resolve();
            await Promise.resolve();
            expect(error).toEqual([{}, 'wamp.error.procedure_already_exists']);
        });

        it('handles a progressive function call', async () => {
            const { channel, mockWebSocket, receive$ } = await prepareWampChannel();
            const funcRsp$ = new Subject<ArgsAndDict>();
            const funcs = {
                func1: (...argsAndDict: ArgsAndDict) => funcRsp$
            };
            spyOn(funcs, 'func1').and.returnValue(funcRsp$);

            channel.register('my.function1', funcs.func1);
            receive$.next('[65,101,123]'); // Func registered
            await Promise.resolve();

            // Call the function
            receive$.next('[68,1000,123,{"receive_progress": true},[123, "abc"],{"some": "data"}]');
            expect(funcs.func1).toHaveBeenCalledWith([123, 'abc'], {some: 'data'});

            expect(mockWebSocket.send).toHaveBeenCalledTimes(1); // Only for registering...

            // Send a response
            funcRsp$.next([['answer', 456], {dictAnswer: 789}]);
            funcRsp$.next([[2]]);
            funcRsp$.complete();
            expect(mockWebSocket.send).toHaveBeenCalledTimes(4);
            expect(mockWebSocket.send).toHaveBeenCalledWith('[70,1000,{"progress":true},["answer",456],{"dictAnswer":789}]');
            expect(mockWebSocket.send).toHaveBeenCalledWith('[70,1000,{"progress":true},[2]]');
            expect(mockWebSocket.send).toHaveBeenCalledWith('[70,1000,{}]');
        });

        it('handles a non-progressive function call', async () => {
            const { channel, mockWebSocket, receive$ } = await prepareWampChannel();
            const funcRsp$ = new Subject<ArgsAndDict>();
            const funcs = {
                func1: (...argsAndDict: ArgsAndDict) => funcRsp$
            };
            spyOn(funcs, 'func1').and.returnValue(funcRsp$);

            channel.register('my.function1', funcs.func1);
            receive$.next('[65,101,123]'); // Func registered
            await Promise.resolve();

            // Call the function non-progress
            receive$.next('[68,1000,123,{},["arg"]]');
            expect(funcs.func1).toHaveBeenCalledWith(['arg'], undefined);

            expect(mockWebSocket.send).toHaveBeenCalledTimes(1); // Only for registering...

            // Send a response
            funcRsp$.next([['not received']]);
            funcRsp$.next([['actual received value']]);
            funcRsp$.complete();
            await Promise.resolve();
            expect(mockWebSocket.send).toHaveBeenCalledTimes(2);
            expect(mockWebSocket.send).toHaveBeenCalledWith('[70,1000,{},["actual received value"]]');
        });

        it('handles a non-progressive function call which emits nothing', async () => {
            const { channel, mockWebSocket, receive$ } = await prepareWampChannel();
            const funcRsp$ = new Subject<ArgsAndDict>();
            const funcs = {
                func1: (...argsAndDict: ArgsAndDict) => funcRsp$
            };
            spyOn(funcs, 'func1').and.returnValue(funcRsp$);

            channel.register('my.function1', funcs.func1);
            receive$.next('[65,101,123]'); // Func registered
            await Promise.resolve();

            // Call the function non-progress
            receive$.next('[68,1000,123,{},["arg"]]');
            expect(funcs.func1).toHaveBeenCalledWith(['arg'], undefined);

            expect(mockWebSocket.send).toHaveBeenCalledTimes(1); // Only for registering...

            // Complete without emitting any payload
            funcRsp$.complete();
            await Promise.resolve();
            expect(mockWebSocket.send).toHaveBeenCalledTimes(2);
            expect(mockWebSocket.send).toHaveBeenCalledWith('[70,1000,{}]');
        });

        it('unregisters a function', async () => {
            const { channel, mockWebSocket, receive$ } = await prepareWampChannel();
            const funcRsp$ = new Subject<ArgsAndDict>();
            const funcs = {
                func1: (...argsAndDict: ArgsAndDict) => funcRsp$
            };
            spyOn(funcs, 'func1').and.returnValue(funcRsp$);

            const registrationPromise = channel.register('my.function1', funcs.func1);
            receive$.next('[65,101,123]'); // Func registered
            await Promise.resolve();

            const registration = await registrationPromise;
            // function is unregistered
            registration.unsubscribe();
            expect(mockWebSocket.send).toHaveBeenCalledTimes(2);
            expect(mockWebSocket.send).toHaveBeenCalledWith('[66,102,123]');

            // func1 is not called anymore cause it is unregistered
            receive$.next('[68,1000,123,{},["arg"]]');
            expect(funcs.func1).toHaveBeenCalledTimes(0);
        });

        it('handles a progressive function call error', async () => {
            const { channel, mockWebSocket, receive$ } = await prepareWampChannel();
            const funcRsp$ = new Subject<ArgsAndDict>();
            const funcs = {
                func1: (...argsAndDict: ArgsAndDict) => funcRsp$
            };
            spyOn(funcs, 'func1').and.returnValue(funcRsp$);

            channel.register('my.function1', funcs.func1);
            receive$.next('[65,101,123]'); // Func registered
            await Promise.resolve();

            // Call the function
            receive$.next('[68,1000,123,{"receive_progress": true},[123, "abc"],{"some": "data"}]');

            // Send an error
            funcRsp$.error({message: 'something went wrong...'});
            expect(mockWebSocket.send).toHaveBeenCalledTimes(2);
            expect(mockWebSocket.send).toHaveBeenCalledWith('[8,68,1000,{},"wamp.error",["something went wrong..."]]');
        });

        it('handles a progressive function call interrupt', async () => {
            const { channel, mockWebSocket, receive$ } = await prepareWampChannel();
            let cancelled = false;
            const funcRsp$ = new Observable<ArgsAndDict>(_ => () => cancelled = true);
            const funcs = {
                func1: (...argsAndDict: ArgsAndDict) => funcRsp$
            };
            spyOn(funcs, 'func1').and.returnValue(funcRsp$);

            channel.register('my.function1', funcs.func1);
            receive$.next('[65,101,123]'); // Func registered
            await Promise.resolve();

            // Call the function
            receive$.next('[68,1000,123,{"receive_progress": true}]');
            expect(cancelled).toBeFalsy();
            receive$.next('[69,1000,{"mode":"kill"}]');
            expect(cancelled).toBeTruthy();
            expect(mockWebSocket.send).toHaveBeenCalledTimes(2);
            expect(mockWebSocket.send).toHaveBeenCalledWith('[8,68,1000,{},"wamp.error.cancelled",["function call has been cancelled"]]');
        });
    });

    describe('publication', () => {
        it('publishes an event', async () => {
            const { channel, mockWebSocket } = await prepareWampChannel();
            channel.publish('some.topic', ['hello', 'event']);
            expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
            expect(mockWebSocket.send).toHaveBeenCalledWith('[16,101,{"acknowledge":true},"some.topic",["hello","event"]]');
        });

        it('waits for publication', async () => {
            const { channel, receive$ } = await prepareWampChannel();
            let pubId = 0;
            channel.publish('some.topic', ['hello', 'event']).then(it => pubId = it);
            expect(pubId).toEqual(0);
            receive$.next('[17,101,1234]'); // PubId is 1234
            await Promise.resolve();
            expect(pubId).toEqual(1234);
        });

        it('aborts on publish rejection', async () => {
            const { channel, receive$ } = await prepareWampChannel();
            let error: any;
            channel.publish('some.topic', ['hello', 'event']).catch(e => error = e);
            expect(error).toBeUndefined();
            receive$.next('[8,16,101,{},"wamp.big.failure"]');
            await Promise.resolve();
            expect(error).toEqual([{}, 'wamp.big.failure']);
        });
    });
});
