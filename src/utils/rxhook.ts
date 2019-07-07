import { Observable, Observer, MonoTypeOperatorFunction } from 'rxjs';

export interface IObservableHook<T> {
  onNext: (v: T) => void;
  onError: (e: any) => void;
  onComplete: () => void;
  onUnsubscribed: () => void;
}

export type HookMaker<T> = () => IObservableHook<T>;

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