import { Observable, Unsubscribable } from 'rxjs';

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
