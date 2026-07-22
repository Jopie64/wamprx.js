import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EMPTY, of, lastValueFrom } from 'rxjs';
import { toWampFunc, wampCall } from './extras';

describe('extras', () => {

    describe('toWampFunc', () => {

        it('turns a normal func into a wamp func', async () => {
            const add = (a: number, b: number) => of(a + b);
            const wampAdd = toWampFunc(add);

            const argsAndDictResult = await lastValueFrom(wampAdd([2, 3]));
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
            const argsAndDictResult = await lastValueFrom(wampAdd(), { defaultValue: undefined });
            expect(sideIsEffected).toBeTruthy();
            expect(argsAndDictResult).toBeUndefined();
        });
    });

    describe('wampCall', () => {
        let channel: any;

        beforeEach(() => {
            channel = {
                call:      vi.fn().mockReturnValue(of([['returnMe']])),
                register:  vi.fn(),
                publish:   vi.fn(),
                subscribe: vi.fn()
            };
        });

        it('makes sure a wamp RPC can be called JavaScript style', async () => {
            const result = await lastValueFrom(wampCall<string>(channel, 'nl.wamprx.do_something', 'first', 'second'));
            expect(result).toBe('returnMe');
            expect(channel.call).toHaveBeenCalledWith('nl.wamprx.do_something', ['first', 'second']);
        });

        it('handles no arguments correctly', async () => {
            const result = await lastValueFrom(wampCall<string>(channel, 'nl.wamprx.do_something'));
            expect(result).toBe('returnMe');
            expect(channel.call).toHaveBeenCalledWith('nl.wamprx.do_something', []);
        });

        it('handles no return value correctly', async () => {
            channel.call = vi.fn().mockReturnValue(EMPTY);
            const result = await lastValueFrom(wampCall(channel, 'nl.wamprx.do_something'), { defaultValue: undefined });
            expect(result).toBeUndefined();
            expect(channel.call).toHaveBeenCalledWith('nl.wamprx.do_something', []);
        });
    });
});
