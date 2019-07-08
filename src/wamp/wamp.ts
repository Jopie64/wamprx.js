import { Observable, of, merge, throwError, defer } from 'rxjs';
import { switchMap, map, mapTo, take, takeWhile, publishReplay, refCount, finalize } from 'rxjs/operators';
import { divide } from '../utils/rxdivide';
import { logObs } from '../utils/rxlog';
import { hookObs } from '../utils/rxhook';

// Minimal WebSocket interface needed for this WAMP implementation
export interface WampWebSocket {
    send: (data: string) => void;
    receive$: Observable<string>;
};

export type ConnectWebSocket = (url: string, protocol: string) => Observable<WampWebSocket>;

const defaultConnectWebSocket: ConnectWebSocket = (url, protocol) => {
    const webSocket$ = new Observable<WebSocket>(newChannelObserver => {
        const ws = new WebSocket(url, protocol);
        ws.onopen = () => newChannelObserver.next(ws);
        ws.onclose = () => newChannelObserver.complete();
        ws.onerror = e => newChannelObserver.error(e);
        return () => ws.close();
    }).pipe(
        logObs('connectWebSocket'),
        publishReplay(1), refCount());

    const receive$ = webSocket$.pipe(
        switchMap(ws => new Observable<string>(msgObserver => {
            const onMsg = (ev: MessageEvent) => msgObserver.next(ev.data);
            ws.onmessage = onMsg;
            return () => {
                if (ws.onmessage === onMsg) {
                    ws.onmessage = null;
                }
            };
        })));

    return webSocket$.pipe(
        map(ws => ({ send: ws.send, receive$ })));
};

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

type Args = any[];
type Dict = {[key: string]: any};

type ArgsAndDict = [Args?, Dict?];


interface HelloMsgDetails {
    roles: {
        caller?: { features?: { progressive_call_results?: boolean, call_canceling?: boolean }}
    },
    authmethods?: string[],
    authid?: string
}
interface CallMsgOptions { receive_progress?: boolean }
interface ResultMsgDetails { progress?: boolean }
interface SubscribeMsgDetails {}
interface EventMsgDetails {}
interface CancelMsgOptions { mode: 'skip' | 'kill' | 'killnowait' }

type WampHelloMsg = [WampMessageEnum.HELLO, string, HelloMsgDetails];
type WampChallengeMsg = [WampMessageEnum.CHALLENGE, string, Dict];
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
    WampHelloMsg | WampChallengeMsg | WampAuthenticateMsg | WampWelcomeMsg |
    WampErrorMsg |
    WampCallMsg | WampResultMsg | WampCancelMsg |
    WampSubscribeMsg | WampSubscribedMsg | WampUnsubscribeMsg | WampUnsubscribedMsg | WampEventMsg;

type ChallengeResponse = string | [string, Dict];

export interface LoginAuth {
    authid: string;
    authmethods: string[];
    challenge: (method: string, extra: Dict) => ChallengeResponse;
}

export interface WampChannel {
    logon(realm: string, auth?: LoginAuth): Promise<void>;
    call(uri: string, args?: Args, dict?: Dict): Observable<ArgsAndDict>;
    subscribe(uri: string): Observable<ArgsAndDict>;
}

const trimArray = (a: any[]): any[] => {
    while (a.length > 0 && a[a.length - 1] === undefined) {
        a.pop();
    }
    return a;
}

const createWampChannelFromWs = (ws: WampWebSocket): WampChannel => {

    // Initial stuff
    const message$ = ws.receive$.pipe(
        map(data => JSON.parse(data) as WampMessage),
        logObs('wamp message'));

    const getMsgOfType = divide((msg: WampMessage) => msg[0], message$);

    // Hopefully we find a way to not require all this casting stuff.
    // Type T should be derivable from msgType somehow...
    // But the keyof operator will only yield a string union when used on enums
    const receive$ = <T>(msgType: WampMessageEnum) =>
        getMsgOfType(msgType as any).pipe(
            map(msg => msg as unknown as T)
        );

    const send = (msg: WampMessage) => {
        const trimmedMsg = trimArray(msg);
        console.debug('*** Sending', trimmedMsg);
        ws.send(JSON.stringify(trimmedMsg));
    };

    // Logon
    const logon = async (realm: string, auth?: LoginAuth): Promise<void> => {
        let helloDetails: HelloMsgDetails = { roles:
            { caller: { features: { progressive_call_results: true, call_canceling: true }}}
        };
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
            receive$<WampChallengeMsg>(WampMessageEnum.CHALLENGE)
        ).pipe(take(1));
        while(true)
        {
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
    let nextReqId = Math.floor(Math.random() * 16777216);
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

export const connectWampChannel = (url: string, realm: string, auth?: LoginAuth, connectWebSocket: ConnectWebSocket = defaultConnectWebSocket) =>
    connectWebSocket(url, 'wamp.2.json').pipe(
        map(createWampChannelFromWs),
        switchMap(channel => channel.logon(realm, auth).then(_ => channel))
    );
