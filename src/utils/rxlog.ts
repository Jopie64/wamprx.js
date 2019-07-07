import { IObservableHook, hookObs } from './rxhook';
import { ILogger, makeConsoleLogger } from './logger';

let creationIdGen = 0;

// To make it easier to test
export const resetCreationIdGen = () => creationIdGen = 0;

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

export const logObs = <T>(n: any) => logSubUnsub<T>(makeConsoleLogger(n), true);
