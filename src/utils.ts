import { Observable, Observer, Subscription, MonoTypeOperatorFunction } from 'rxjs';

// *** Logging

let nextId = 0;

export const makeId = () => ++nextId;

type LogFunc = (...msg: any[]) => void;
export interface ILogger {
    log:   LogFunc;
    warn:  LogFunc;
    error: LogFunc;
}

export const makeLogger = (custHdr?: any): ILogger => {
    const hdr = custHdr || `[${makeId()}]`;
    return {
        log: (...msg)   => console.log(hdr, ...msg),
        warn: (...msg)  => console.warn(hdr, ...msg),
        error: (...msg) => console.error(hdr, ...msg),
    };
};

export interface IObservableHook<T> {
  onNext: (v: T) => void;
  onError: (e: any) => void;
  onComplete: () => void;
  onUnsubscribed: () => void;
}

type HookMaker<T> = () => IObservableHook<T>;

export const hookObs = <T>(hookMaker: HookMaker<T>): MonoTypeOperatorFunction<T> =>
  (source: Observable<T>): Observable<T> => Observable.create((observer: Observer<T>) => {
    const h = hookMaker();
    const subscription = source.subscribe(
      n => {
        h.onNext(n);
        observer.next(n);
      },
      e => {
        h.onError(e);
        observer.error(e);
      },
      () => {
        h.onComplete();
        observer.complete();
      }
    );
    return () => {
      h.onUnsubscribed();
      subscription.unsubscribe();
    };
  });

let creationIdGen = 0;

export const logSubUnsub = <T>(logger: ILogger, logNext: boolean) => {
  const observerId = ++creationIdGen;
  let subscriptionIdGen = 0;
  logger.log(`${observerId}-CREATED`);
  return hookObs((): IObservableHook<T> => {
    const subId = ++subscriptionIdGen;
    let seq = 0;
    const log = (msg: string, ...rest: any[]) => logger.log(`${observerId}-${subId}-${msg}-${++seq}`, ...rest);
    log('SUBSCRIBED');
    return ({
      onNext:         logNext ? ((n: T) => log('NEXT', n)) : (_ => {}),
      onError:        e  => log('ERROR', e),
      onComplete:     () => log('COMPLETE'),
      onUnsubscribed: () => log('UNSUBSCRIBED')
    });
  });
};

export const logObs = <T>(n: any) => logSubUnsub<T>(makeLogger(n), true);


// *** divide

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
