import { Observable, Observer, Subscription } from 'rxjs';

type KeySelector<TKey, TValue> = (value: TValue) => TKey;

interface IObservableDivider<TKey, TValue> {
    getDivision(key: TKey): Observable<TValue>;
}

type DivideFunc = <TKey extends keyof {[key: string]: any}, TValue>(
        keySelector: KeySelector<TKey, TValue>,
        obs$: Observable<TValue>
    ) => IObservableDivider<TKey, TValue>;

export const divide: DivideFunc = <TKey extends keyof {[key: string]: any}, TValue>(
    keySelector: KeySelector<TKey, TValue>,
    obs$: Observable<TValue>
) => {
    let divisions: {[key: string]: Observer<TValue>} = {};

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

    return {
        getDivision: key => Observable.create((observer: Observer<TValue>) => {
            divisions[key] = observer;
            ensureSubscribed();
            return () => {
                delete divisions[key];
                maybeUnsubscribe();
            };
        })
    }
};
