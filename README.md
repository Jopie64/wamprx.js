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
const channel = await toPromise(connectWampChannel('ws://my.wamp.url/ws', 'realm1'));

const [[answer]] = await channel.call('add', [1, 2]).toPromise();

if (answer !== 3) {
    console.error(`${answer} is the wrong answer!`);
} else {
    console.log('Answer 3 is correct');
}
```

Or any combination of it.

## Helper to call functions in a more natural way

To call simple WAMP functions in a more natural way, you can use `wampCall()` like this:

```typescript
const answer = await wampCall(channel, 'add', 1, 2).toPromise();
```

Or turn it into a normal method first to call it later:

```typescript
const add = (a: number, b: number): Promise<number> =>
    wampCall(channel, 'add', a, b).toPromise();

const answer = await add(1, 2);
```

## Imperative way

Note that when you want to use the imperative way, you can't simply use `connectWampChannel(...).toPromise()`, but you have to use the `toPromise()` method from wamprx. That is because the `channel$` observable returned from `connectWampChannel(...)` should be treated as a resource. Which is to say, it connects when it is subscribed, and *it disconnects when it is unsubscribed*. So when you use `.toPromise()`, it will unsubscribe and hence disconnect the channel once it returns.

When you use the imperative method, a channel can be closed again by calling:

```typescript
channel.unsubscribe();
```

## Destructuring

Note the strange looking `[[answer]]`. This is actually [destructuring](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring_assignment) the WAMP response which is of type `ArgsAndDict`. ArgsAndDict is a tuple of an array (`Args`) and a dictionary (object) (`Dict`), which in WAMP is the usual way to pass arguments or return values. `[[answer]]` is hence selecting the first argument of the `Args`.

If you can't (or don't want to) use destructuring for some reason, you can achieve the same result like this:

```typescript
const argsAndDict = await channel.call('add', [1, 2]).toPromise();
const answer = argsAndDict[0][0]; // First [0] selecting args, second for selecting first arg
```

or simply use `wampCall()`. See above.

## Registering a function

```typescript
const channel = await toPromise(connectWampChannel('ws://my.wamp.url/ws', 'realm1'));

const registration = channel.register('add', ([a, b]) => of([[a + b]]);
```

Most of the time, you will probably only register simple functions with a list of arguments and a simple return value. In those cases you don't need to bother with WAMP's `ArgsAndDict` type, and you can use `toWampFunc()` for that like this:

```typescript
// simple function to be registered:
const add = (a, b) => of(a + b);

// Using toWampFunc() to turn it into a registerable function.
const registration = channel.register('add', toWampFunc(add));
```

To unregister:

```typescript
registration.unsubscribe();
```

## With authentication

```typescript
const auth = {
    authid: 'myId',
    authmethods: ['ticket'],
    challenge: (method, extra) => 'some ticket'
};
const channel = await toPromise(connectWampChannel('ws://my.wamp.url/ws', 'realm1', auth));
```

## Using it in node.js

Because the library is primarily used in the browser, it defaults to using the browsers `WebSocket` implementation.
You can however use it in node.js too like this:

```typescript
import * as WebSocket from 'ws';
//...
const useWs = makeObservableWebSocket(
    (url, protocol) => new WebSocket(url, protocol));

const channel = await toPromise(connectWampChannel('ws://my.wamp.url/ws', 'realm1', undefined, useWs));
```

## Reconnect on lost connection

wamprx.js doesn't support autoreconnect natively. However, since it is based on RxJS, it is accomplished easily by using RxJS operators.

When the wamp channel disconnects, or is not able to connect, it will emit an error. To reconnect simply use `retryWhen()` like this:

```typescript
connectWampChannel('ws://my.wamp.url/ws', 'realm1').pipe(
    // Retry every 5 seconds...
    retryWhen(errors => errors.pipe(delay(5000)))
    .subscribe(connectedChannel => ...);
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
