# wamprx.js

Simple [WAMP](https://wamp-proto.org) (WebSocket Application Messaging Protocol) TypeScript client-side implementation (of course also usable in JavaScript).

It heavily relies on [RxJS](https://www.learnrxjs.io/).

# Usage examples

## Creating a channel and call an RPC

```typescript
connectWampChannel('ws://my.wamp.url/ws', 'realm1').pipe(
    switchMap(channel => channel.call('add', [1, 2])))
    .subscribe(([[answer]]) => answer !== 3
        ? console.error(`${answer} is the wrong answer!`)
        : console.log('Answer 3 is correct'));
```

Or imperatively:

```typescript
const channel = await connectWampChannel('ws://my.wamp.url/ws', 'realm1').toPromise();

const [[answer]] = await channel.call('add', [1, 2]).toPromise();

if (answer !== 3) {
    console.error(`${answer} is the wrong answer!`);
} else {
    console.log('Answer 3 is correct');
}
```

Or any combination of it.

Note the strange looking `[[answer]]`. This is actually [destructuring](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment) the WAMP response which is of type `ArgsAndDict`. ArgsAndDict is a tuple of an array (`Args`) and a dictionary (object) (`Dict`), which in WAMP is the usual way to pass arguments or return values. `[[answer]]` is hence selecting the first argument of the `Args`.

If you can't (or don't want to) use destructuring for some reason, you can achieve the same result like this:

```typescript
const argsAndDict = await channel.call('add', [1, 2]).toPromise();
const answer = argsAndDict[0][0]; // First [0] selecting args, second for selecting first arg
```

## With authentication

```typescript
const auth = {
    authid: 'myId',
    authmethods: ['ticket'],
    challenge: (method, extra) => 'some ticket'
};
const channel = await connectWampChannel('ws://my.wamp.url/ws', 'realm1', auth).toPromise();
```

## Using it in node.js

Because the library is primarily used in the browser, it defaults to using the browsers `WebSocket` implementation.
You can however use it in node.js too like this:

```typescript
import * as WebSocket from 'ws';
//...
const useWs = makeObservableWebSocket(
    (url, protocol) => new WebSocket(url, protocol));

const channel = await connectWampChannel('ws://my.wamp.url/ws', 'realm1', undefined, useWs).toPromise();
```

# WAMP features support

See following interface for what is supported:

```typescript
interface WampChannel {
    call(uri: string, args?: Args, dict?: Dict): Observable<ArgsAndDict>;
    register(uri: string, func: RegisteredFunc): Promise<Subscription>;
    publish(uri: string, args?: Args, dict?: Dict): Promise<number>;
    subscribe(uri: string): Observable<ArgsAndDict>;
}
```

## Serialization

Currently the only serialization method supported is JSON (`wamp.2.json`).

## RPC caller

For all RPC calls, it uses the `receive_progress=true` option. Also, the `Observable<ArgsAndDict>` returned by `call` is cold. Hence the method is called only once it is subscribed, and it is called twice (with the same arguments) when it is subscribed twice.

When you don't want that, simply turn it into a promise via `.toPromise()`.

## RPC callee

When a registered function is called with option `receive_progress=true`, all payload is sent to the caller with option `progress=true`. When the returned observable emits complete, it will emit the final result without `progress=true` and without any payload.

When a registered function is called *without* option `receive_progress=true`, it will only send the *last emitted payload* to the caller when the returned observable completes, (or no payload when it completes without emitting any payload). This is the behavior as if .toPromise() was called on the observable.
