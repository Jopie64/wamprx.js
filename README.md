# wamprx.js

Simple [WAMP](https://wamp-proto.org) (WebSocket Application Messaging Protocol) TypeScript client-side implementation (of course also usable in JavaScript).

It heavily relies on [RxJS](https://www.learnrxjs.io/), which is for now it's only dependency.

# Simple usage example

```typescript
connectWampChannel('http://my.wamp.url/ws', 'realm1').pipe(
    switchMap(channel => channel.call('add', [1, 2])))
    .subscribe(answer => answer !== 3
        ? console.error(`${answer} is the wrong answer!`)
        : console.log('Answer 3 is correct'));
```

Or imperatively:

```typescript
const channel = await connectWampChannel('http://my.wamp.url/ws', 'realm1').toPromise();

const answer = await channel.call('add', [1, 2]).toPromise();

if (answer !== 3) {
    console.error(`${answer} is the wrong answer!`);
} else {
    console.log('Answer 3 is correct');
}
```

Or any combination of it.


# WAMP features support

It for now only supports a subset of the total featureset. The interface definition should say it all:

```typescript
interface WampChannel {
    logon(realm: string, auth?: LoginAuth): Promise<void>;
    call(uri: string, args?: Args, dict?: Dict): Observable<ArgsAndDict>;
    subscribe(uri: string): Observable<ArgsAndDict>;
}
```

Note that for all RPC calls, it uses the `receive_progress=true` option. Also, the `Observable<ArgsAndDict>` returned by `call` is cold. Hence the method is called only once it is subscribed, and it is called twice (with the same arguments) when it is subscribed twice.

When you don't want that, simply turn it into a promise via `.toPromise()`.
