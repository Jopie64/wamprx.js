import { divide } from './rxdivide';
import { Subject, Observable } from 'rxjs';

describe('utils', () => {
    describe('rxdivide', () => {
        interface GroupedValue {
            idGroup: number;
            val: string;
        }
        const idGroupSelector = (it: GroupedValue) => it.idGroup;

        const makeVal = (idGroup: number, val: string) => ({ idGroup, val });

        it('devides the stream', () => {
            const value$ = new Subject<GroupedValue>();
            const getDivision = divide(idGroupSelector, value$);

            const group1: GroupedValue[] = [];
            const group2: GroupedValue[] = [];
            getDivision(1).subscribe(it => group1.push(it));
            getDivision(2).subscribe(it => group2.push(it));

            expect(group1).toEqual([]);
            expect(group2).toEqual([]);

            value$.next(makeVal(1, 'hello'));
            expect(group1).toEqual([makeVal(1, 'hello')]);
            expect(group2).toEqual([]);

            value$.next(makeVal(2, 'world'));
            expect(group1).toEqual([makeVal(1, 'hello')]);
            expect(group2).toEqual([makeVal(2, 'world')]);

            value$.next(makeVal(1, 'bye'));
            expect(group1).toEqual([makeVal(1, 'hello'), makeVal(1, 'bye')]);
            expect(group2).toEqual([makeVal(2, 'world')]);

            value$.next(makeVal(3, 'ends nowhere'));
            expect(group1).toEqual([makeVal(1, 'hello'), makeVal(1, 'bye')]);
            expect(group2).toEqual([makeVal(2, 'world')]);
        });

        it('subscribes and unsubscribes the base stream at the right time', () => {
            let nSubscribed = 0;
            let nUnsubscribed = 0;
            const base$ = new Observable<GroupedValue>(() => {
                ++nSubscribed;
                return () => ++nUnsubscribed;
            });
            const getDivision = divide(idGroupSelector, base$);

            const division1$ = getDivision(1);
            const division2$ = getDivision(2);

            // No subscriptions yet
            expect(nSubscribed).toBe(0);
            expect(nUnsubscribed).toBe(0);

            // One division subscribed. Subscribe base.
            let subscription1 = division1$.subscribe();
            expect(nSubscribed).toBe(1);
            expect(nUnsubscribed).toBe(0);

            // The only subscribed division unsubscribed. Unsubscribe base.
            subscription1.unsubscribe();
            expect(nSubscribed).toBe(1);
            expect(nUnsubscribed).toBe(1);

            // One division subscribed. Subscribe base.
            let subscription2 = division2$.subscribe();
            expect(nSubscribed).toBe(2);
            expect(nUnsubscribed).toBe(1);

            // Second division also subscribed. Base already subscribed.
            subscription1 = division1$.subscribe();
            expect(nSubscribed).toBe(2);
            expect(nUnsubscribed).toBe(1);

            // Unsubscribe one of the divisions. Base remains subscribed.
            subscription2.unsubscribe();
            expect(nSubscribed).toBe(2);
            expect(nUnsubscribed).toBe(1);

            // Both divisions unsubscribed. Unsubscribe base.
            subscription1.unsubscribe();
            expect(nSubscribed).toBe(2);
            expect(nUnsubscribed).toBe(2);
        })
    });
});