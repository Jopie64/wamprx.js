import 'jasmine';
import { logSubUnsub } from './rxlog';
import { makeConsoleLogger } from './logger';
import { of } from 'rxjs';

describe('utils', () => {
    describe('logObs', () => {
        it('logs all observable events', () => {
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
    });
});
