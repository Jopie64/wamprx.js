import { Observable, Subscription, Subscriber } from 'rxjs';

type KeySelector<TKey, TValue> = (value: TValue) => TKey;

type GetDivision<TKey, TValue> = (key: TKey) => Observable<TValue>;

type DivideFunc = <TKey extends keyof {[key: string]: any}, TValue>(
        keySelector: KeySelector<TKey, TValue>,
        obs$: Observable<TValue>
    ) => GetDivision<TKey, TValue>;

export const divide: DivideFunc = <TKey extends keyof {[key: string]: any}, TValue>(
    keySelector: KeySelector<TKey, TValue>,
    obs$: Observable<TValue>
) => {
    let divisions: {[key: string]: Subscriber<TValue>} = {};

    let srcSubscription: Subscription | null = null;

    const completeAll = (e?: any) => {
        for (let key in divisions) {
            if (e !== undefined) {
                divisions[key].error(e);
            } else {
                divisions[key].complete();
            }
        }
        divisions = {};
        maybeUnsubscribe();
    }

    const ensureSubscribed = () => {
        if (srcSubscription) {
            return;
        }
        srcSubscription = obs$.subscribe(
            it => {
                const key = keySelector(it);
                const observer = divisions[key];
                if (!observer) {
                    console.warn(`No observer for key ${key}`, it);
                    return;
                }
                observer.next(it);
            },
            completeAll,
            completeAll
        );
    };

    const maybeUnsubscribe = () => {
        if (!srcSubscription || Object.keys(divisions).length !== 0) {
            return;
        }
        srcSubscription.unsubscribe();
        srcSubscription = null;
    }

    return key => new Observable<TValue>(observer => {
        divisions[key] = observer;
        ensureSubscribed();
        return () => {
            delete divisions[key];
            maybeUnsubscribe();
        };
    });
};
