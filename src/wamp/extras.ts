import { Observable, Unsubscribable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RegisteredFunc, WampChannel } from './wamp';

export const toPromise = <T>(resource$: Observable<T>) =>
    new Promise<T & Unsubscribable>((resolve, reject) => {
        const subscription: Unsubscribable = resource$
            .subscribe(resource =>
                resolve({
                    ...resource,
                    unsubscribe: () => subscription.unsubscribe()
                }),
                reject
            );
    });

export const toWampFunc = (origFunc: (...args: any[]) => Observable<any>): RegisteredFunc =>
    args => origFunc(...(args || [])).pipe(map(it => [[it]]));

export const wampCall = <T = any>(channel: WampChannel, uri: string, ...args: any[]): Observable<T> =>
    channel.call(uri, args).pipe(map(([ret]) => (ret || [])[0]));
