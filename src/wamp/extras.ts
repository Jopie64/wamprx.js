import { Observable, Unsubscribable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RegisteredFunc } from './wamp';

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
    ([...args]) => origFunc(...args).pipe(map(it => [[it]]));
