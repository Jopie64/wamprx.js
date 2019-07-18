import { Observable, of, merge, throwError, defer } from 'rxjs';
import { switchMap, map, take, takeWhile, finalize, shareReplay, flatMap } from 'rxjs/operators';
import { divide, hookObs, ILogger, logSubUnsub } from 'rxjs-utilities';

// Minimal WebSocket abstraction interface needed for this WAMP implementation
export interface WampWebSocket {
    send: (data: string) => void;
    receive$: Observable<string>;
};

export interface IMessageEvent { data: any; }

// Minimal WebSocket interface needed for makeObservableWebSocket()
// It fits the WebSocket type from the browser and from the ws lib.
export interface IWebSocket {
    onclose: ((...args: any[]) => any) | null;
    onerror: ((e: any) => any) | null;
    onmessage: ((ev: any) => any) | null; // ev must at least fit interface IMessageEvent
    onopen: ((...args: any[]) => any) | null;
    close(): void;
    send(data: string): void;
}

export type MakeWebSocket = (url: string, protocol: string) => IWebSocket;
export type MakeObservableWebSocket = (url: string, protocol: string) => Observable<WampWebSocket>;

export type Args = any[];
export type Dict = {[key: string]: any};
export type ArgsAndDict = [Args?, Dict?];

export type ChallengeResponse = string | [string, Dict];

export interface LoginAuth {
    authid: string;
    authmethods: string[];
    challenge: (method: string, extra: Dict) => ChallengeResponse;
}

export interface WampChannel {
    call(uri: string, args?: Args, dict?: Dict): Observable<ArgsAndDict>;
    subscribe(uri: string): Observable<ArgsAndDict>;
}

export const makeObservableWebSocket = (makeWebSocket: MakeWebSocket): MakeObservableWebSocket => (url, protocol) => {
    const webSocket$ = new Observable<IWebSocket>(newChannelObserver => {
        const ws = makeWebSocket(url, protocol);
        ws.onopen = () => newChannelObserver.next(ws);
        ws.onclose = () => newChannelObserver.error(new Error('Websocket disconnected'));
        ws.onerror = e => newChannelObserver.error(e.error);
        return () => {
            try {
                ws.close();
            } catch(_) {
                // Ignore 'close()' exceptions. We're not interested in this websocket anymore
            }
        };
    }).pipe(
        shareReplay({bufferSize: 1, refCount: true}));

    const receive$ = webSocket$.pipe(
        switchMap(ws => new Observable<string>(msgObserver => {
            const onMsg = (ev: IMessageEvent) => msgObserver.next(ev.data);
            ws.onmessage = onMsg;
            return () => {
                if (ws.onmessage === onMsg) {
                    ws.onmessage = null;
                }
            };
        })));

    return webSocket$.pipe(
        map(ws => ({ send: data => ws.send(data), receive$ })));
};

const defaultMakeObservableWebSocket = makeObservableWebSocket((url, protocol) => new WebSocket(url, protocol));

export type MakeLogger = (hdr: string) => ILogger;

enum WampMessageEnum {
    HELLO = 1,
    WELCOME = 2,
    ABORT = 3,
    CHALLENGE = 4,
    AUTHENTICATE = 5,
    GOODBYE = 6,
    ERROR = 8,
    PUBLISH = 16,
    PUBLISHED = 17,
    SUBSCRIBE = 32,
    SUBSCRIBED = 33,
    UNSUBSCRIBE = 34,
    UNSUBSCRIBED = 35,
    EVENT = 36,
    CALL = 48,
    CANCEL = 49,
    RESULT = 50,
    REGISTER = 64,
    REGISTERED = 65,
    UNREGISTER = 66,
    UNREGISTERED = 67,
    INVOCATION = 68,
    INTERRUPT = 69,
    YIELD = 70
};

interface HelloMsgDetails {
    roles: {
        caller?: { features?: { progressive_call_results?: boolean, call_canceling?: boolean }},
        subscriber?: {}
    },
    authmethods?: string[],
    authid?: string
}
interface CallMsgOptions { receive_progress?: boolean }
interface ResultMsgDetails { progress?: boolean }
interface SubscribeMsgDetails {}
interface EventMsgDetails {}
interface CancelMsgOptions { mode: 'skip' | 'kill' | 'killnowait' }

// See the WAMP RFC for the meaning of all these messages
// https://wamp-proto.org/_static/gen/wamp_latest.html
type WampHelloMsg = [WampMessageEnum.HELLO, string, HelloMsgDetails];
type WampChallengeMsg = [WampMessageEnum.CHALLENGE, string, Dict];
type WampAbortMsg = [WampMessageEnum.ABORT, Dict, string];
type WampAuthenticateMsg = [WampMessageEnum.AUTHENTICATE, string, Dict];
type WampWelcomeMsg = [WampMessageEnum.WELCOME, number, Dict];
type WampErrorMsg = [WampMessageEnum.ERROR, WampMessageEnum, number, Dict, string, Args?, Dict?];
type WampCallMsg = [WampMessageEnum.CALL, number, CallMsgOptions, string, Args?, Dict?];
type WampResultMsg = [WampMessageEnum.RESULT, number, ResultMsgDetails, Args?, Dict?];
type WampCancelMsg = [WampMessageEnum.CANCEL, number, CancelMsgOptions];
type WampSubscribeMsg = [WampMessageEnum.SUBSCRIBE, number, SubscribeMsgDetails, string];
type WampSubscribedMsg = [WampMessageEnum.SUBSCRIBED, number, number];
type WampUnsubscribeMsg = [WampMessageEnum.UNSUBSCRIBE, number, number];
type WampUnsubscribedMsg = [WampMessageEnum.UNSUBSCRIBED, number];
type WampEventMsg = [WampMessageEnum.EVENT, number, number, EventMsgDetails, Args?, Dict?];

type WampMessage =
    WampHelloMsg | WampChallengeMsg | WampAuthenticateMsg | WampWelcomeMsg | WampAbortMsg |
    WampErrorMsg |
    WampCallMsg | WampResultMsg | WampCancelMsg |
    WampSubscribeMsg | WampSubscribedMsg | WampUnsubscribeMsg | WampUnsubscribedMsg | WampEventMsg;

const trimArray = (a: any[]): any[] => {
    while (a.length > 0 && a[a.length - 1] === undefined) {
        a.pop();
    }
    return a;
}

interface WampChannelWithLogon extends WampChannel {
    logon(realm: string, auth?: LoginAuth): Promise<void>;
}

let nextIdChannel = 0;

export const createWampChannelFromWs = (ws: WampWebSocket, makeLogger: MakeLogger, initialReqId?: number): WampChannelWithLogon => {
    const idChannel = ++nextIdChannel;
    const logger = makeLogger(`${idChannel}/`);
    const logObs = <T>(hdr: string) => logSubUnsub<T>(makeLogger(`${idChannel}/${hdr}`), true);
    // Initial stuff
    const message$ = ws.receive$.pipe(
        map(data => JSON.parse(data) as WampMessage),
        logObs('receive'));

    const getMsgOfType = divide(([msgType]) => msgType, message$);

    // Hopefully we find a way to not require all this casting stuff.
    // Type T should be derivable from msgType somehow...
    // But the keyof operator will only yield a string union when used on enums
    const receive$ = <T>(msgType: WampMessage[0]) =>
        getMsgOfType(msgType).pipe(
            map(msg => msg as unknown as T)
        );

    const send = (msg: WampMessage) => {
        const trimmedMsg = trimArray(msg);
        logger.log('send', trimmedMsg);
        ws.send(JSON.stringify(trimmedMsg));
    };

    // Logon
    const logon = async (realm: string, auth?: LoginAuth): Promise<void> => {
        let helloDetails: HelloMsgDetails = { roles: {
            caller: { features: { progressive_call_results: true, call_canceling: true }},
            subscriber: {}
        }};
        if (auth) {
            helloDetails = {
                ...helloDetails,
                authid: auth.authid,
                authmethods: auth.authmethods
            };
        }
        send([WampMessageEnum.HELLO, realm, helloDetails]);
        const welcomeOrChallenge$ = merge(
            receive$<WampWelcomeMsg>(WampMessageEnum.WELCOME),
            receive$<WampChallengeMsg>(WampMessageEnum.CHALLENGE),
            receive$<WampAbortMsg>(WampMessageEnum.ABORT)
                .pipe(flatMap(([, ...error]) => throwError(error)))
        ).pipe(take(1));
        while(true) {
            const welcomeOrChallenge = await welcomeOrChallenge$.toPromise();
            if (welcomeOrChallenge[0] === WampMessageEnum.WELCOME) {
                return;
            }
            if (!auth) {
                throw new Error('Received unexpected challenge');
            }
            const [, method, extra ] = welcomeOrChallenge;
            const sig = auth.challenge(method, extra);
            if (Array.isArray(sig)) {
                const msg = [WampMessageEnum.AUTHENTICATE, ...sig];
                // Expected type of msg should be [WampMessageEnum.AUTHENTICATE, string, Dict]
                // which is the signature of WampAuthenticateMsg.
                // But current version of TypeScript makes it (string | WampMessageEnum | Dict)[]
                // Hence we need a cast here :(
                send(msg as WampAuthenticateMsg);
            } else {
                send([WampMessageEnum.AUTHENTICATE, sig, {}]);
            }
        }
    }

    // Requests general
    let nextReqId = initialReqId || Math.floor(Math.random() * 16777216);
    const error$ = divide(([,, reqId]: WampErrorMsg) => reqId, receive$<WampErrorMsg>(WampMessageEnum.ERROR));
    const throwWhenError$ = (reqId: number) => error$(reqId).pipe(
        switchMap(([,,, ...e]) => throwError(e)));

    // RPC
    const result$ = divide(([, reqId]: WampResultMsg) => reqId, receive$<WampResultMsg>(WampMessageEnum.RESULT));

    const call = (uri: string, args?: Args, dict?: Dict) => defer(() => {
        const reqId = ++nextReqId;
        send([WampMessageEnum.CALL, reqId, { receive_progress: true}, uri, args, dict]);
        return of(reqId)
    }).pipe(
        switchMap(reqId => merge(
            result$(reqId),
            throwWhenError$(reqId)
            ).pipe(
                takeWhile(msg => !!msg[2].progress, true),
                // Make sure it only cancels the call when it is unsubscribed before it
                // was otherwise completed.
                hookObs(() => {
                    let complete = false;
                    return {
                        onError: () => complete = true,
                        onNext: () => {},
                        onComplete: () => complete = true,
                        onUnsubscribed: () => {
                            if (!complete) {
                                send([WampMessageEnum.CANCEL, reqId, { mode: 'kill' }]);
                            }
                        }
                    };
                }))
        ),
        map(([,,, ...args]) => args),
        logObs(`call ${uri}`));

    // PubSub
    const subscribed$ = divide(([, reqId]: WampSubscribedMsg) => reqId, receive$<WampSubscribedMsg>(WampMessageEnum.SUBSCRIBED));
    const event$      = divide(([, subsId]: WampEventMsg) => subsId, receive$<WampEventMsg>(WampMessageEnum.EVENT));

    const subscribe = (uri: string) => defer(() => {
        const reqId = ++nextReqId;
        send([WampMessageEnum.SUBSCRIBE, reqId, {}, uri]);
        return merge(
            subscribed$(reqId).pipe(
                map(([,,subsId]) => subsId)
            ),
            throwWhenError$(reqId)
        )
    }).pipe(
        switchMap(subsId => event$(subsId).pipe(
            finalize(() => send([WampMessageEnum.UNSUBSCRIBE, ++nextReqId, subsId]))
        )),
        map(([,,,,...argsAndDict]) => argsAndDict),
        logObs(`subscribe ${uri}`));

    // Return object
    return {
        logon,
        call,
        subscribe
    };
};

export const makeNullLogger = (): ILogger => ({
    debug: () => {},
    log: () => {},
    warn: () => {},
    error: () => {}
});

// Redefined here, so in the console you can see it is logged from wamp.js
export const makeConsoleLogger: MakeLogger = hdr => ({
    debug: (...msg) => console.debug(hdr, ...msg),
    log: (...msg)   => console.log(hdr, ...msg),
    warn: (...msg)  => console.warn(hdr, ...msg),
    error: (...msg) => console.error(hdr, ...msg)
});

export const connectWampChannel = (
    url: string, realm: string, auth?: LoginAuth,
    makeObservableWebSocket: MakeObservableWebSocket = defaultMakeObservableWebSocket,
    makeLogger: MakeLogger = makeNullLogger
): Observable<WampChannel> =>
    makeObservableWebSocket(url, 'wamp.2.json').pipe(
        map(ws => createWampChannelFromWs(ws, makeLogger)),
        switchMap(channel => channel.logon(realm, auth).then(_ => channel)),
        map(({logon, ...channel}): WampChannel => channel)
    );
