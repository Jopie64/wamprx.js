import { EMPTY, of } from 'rxjs';
import {toWampFunc, wampCall} from './extras';

describe('extras', () => {

    describe('toWampFunc', () => {

        it('turns a normal func into a wamp func', async () => {
            const add = (a: number, b: number) => of(a + b);
            const wampAdd = toWampFunc(add);

            const argsAndDictResult = await wampAdd([2, 3]).toPromise();
            expect(argsAndDictResult[0]![0]).toBe(5);
        });

        it('handles void funcs correctly', async () => {
            let sideIsEffected = false;
            const doSideEffect = () => {
                sideIsEffected = true;
                return EMPTY;
            }
            const wampAdd = toWampFunc(doSideEffect);

            expect(sideIsEffected).toBeFalsy();
            const argsAndDictResult = await wampAdd().toPromise();
            expect(sideIsEffected).toBeTruthy();
            expect(argsAndDictResult).toBeUndefined();
        });
    });

    describe('wampCall', () => {
        let channel: {
            call: jasmine.Spy<jasmine.Func>;
            register: jasmine.Spy<jasmine.Func>;
            publish: jasmine.Spy<jasmine.Func>;
            subscribe: jasmine.Spy<jasmine.Func>;
        };

        beforeEach(() => {
            channel = {
                call:      jasmine.createSpy('call').and.returnValue(of([['returnMe']])),
                register:  jasmine.createSpy('register'),
                publish:   jasmine.createSpy('publish'),
                subscribe: jasmine.createSpy('subscribe')
            };
        });

        it('makes sure a wamp RPC can be called JavaScript style', async () => {
            const result = await wampCall<string>(channel, 'nl.wamprx.do_something', 'first', 'second').toPromise();
            expect(result).toBe('returnMe');
            expect(channel.call).toHaveBeenCalledWith('nl.wamprx.do_something', ['first', 'second']);
        });

        it('handles no arguments correctly', async () => {
            const result = await wampCall<string>(channel, 'nl.wamprx.do_something').toPromise();
            expect(result).toBe('returnMe');
            expect(channel.call).toHaveBeenCalledWith('nl.wamprx.do_something', []);
        });

        it('handles no return value correctly', async () => {
            channel.call = jasmine.createSpy('call').and.returnValue(EMPTY);
            const result = await wampCall(channel, 'nl.wamprx.do_something').toPromise();
            expect(result).toBeUndefined();
            expect(channel.call).toHaveBeenCalledWith('nl.wamprx.do_something', []);
        });
    });
});
