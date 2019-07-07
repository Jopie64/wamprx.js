import 'jasmine';
import { logSubUnsub, resetCreationIdGen } from './rxlog';
import { makeConsoleLogger } from './logger';
import { of, throwError } from 'rxjs';

describe('utils', () => {
    // also indirectly tests rxhook
    describe('logObs', () => {
        it('logs all observable events', () => {
            resetCreationIdGen();
            const logger = makeConsoleLogger('test');
            spyOn(logger, 'log');

            // Creating the observable logger will result in 'CREATED' message
            const obs = of(1, 2, 3).pipe(logSubUnsub(logger, true));
            expect(logger.log).toHaveBeenCalledTimes(1);
            expect(logger.log).toHaveBeenCalledWith('1-CREATED');

            // Subscribing it will cause the other events
            obs.subscribe();
            expect(logger.log).toHaveBeenCalledTimes(7);
            expect(logger.log).toHaveBeenCalledWith('1-1-SUBSCRIBED-1');
            expect(logger.log).toHaveBeenCalledWith('1-1-NEXT-2', 1);
            expect(logger.log).toHaveBeenCalledWith('1-1-NEXT-3', 2);
            expect(logger.log).toHaveBeenCalledWith('1-1-NEXT-4', 3);
            expect(logger.log).toHaveBeenCalledWith('1-1-COMPLETE-5');
            expect(logger.log).toHaveBeenCalledWith('1-1-UNSUBSCRIBED-6');

            // Subscribing it again will cause another set of events
            obs.subscribe();
            expect(logger.log).toHaveBeenCalledTimes(13);
            expect(logger.log).toHaveBeenCalledWith('1-2-SUBSCRIBED-1');
            expect(logger.log).toHaveBeenCalledWith('1-2-NEXT-2', 1);
            expect(logger.log).toHaveBeenCalledWith('1-2-NEXT-3', 2);
            expect(logger.log).toHaveBeenCalledWith('1-2-NEXT-4', 3);
            expect(logger.log).toHaveBeenCalledWith('1-2-COMPLETE-5');
            expect(logger.log).toHaveBeenCalledWith('1-2-UNSUBSCRIBED-6');
        });

        it('logs errors', () => {
            resetCreationIdGen();
            const logger = makeConsoleLogger('test');
            spyOn(logger, 'log');

            const obs = throwError(new Error('uhoh...')).pipe(logSubUnsub(logger, true));

            expect(logger.log).toHaveBeenCalledTimes(1);
            expect(logger.log).toHaveBeenCalledWith('1-CREATED');

            obs.subscribe(null, () => {});
            expect(logger.log).toHaveBeenCalledTimes(4);
            expect(logger.log).toHaveBeenCalledWith('1-1-SUBSCRIBED-1');
            expect(logger.log).toHaveBeenCalledWith('1-1-ERROR-2', new Error('uhoh...'));
            expect(logger.log).toHaveBeenCalledWith('1-1-UNSUBSCRIBED-3');
        });
    });
});
