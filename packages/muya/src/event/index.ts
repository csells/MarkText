import type { IEvent, IListeners, Listener } from './types';
import { CollectedError } from '../utils/collectedError';

// TODO: @Jocs use the same name function in utils.
function* uniqueIdGenerator() {
    let id = 0;

    while (true)
        yield id++;
}
const PREFIX = 'event-';
const idIterator = uniqueIdGenerator();

interface IBufferedEvent {
    event: string;
    data: unknown[];
}

class EventCenter {
    public events: IEvent[] = [];
    public listeners: IListeners = {};
    private _suppressionDepth = 0;
    private _eventBuffers: IBufferedEvent[][] = [];

    private get _eventId() {
        return `${PREFIX}${idIterator.next().value}`;
    }

    /**
     * [attachDOMEvent] bind event listener to target, and return a unique ID,
     * this ID
     */
    attachDOMEvent(
        target: HTMLElement | Document,
        event: string,
        listener: EventListener,
        capture?: boolean | AddEventListenerOptions,
    ): string {
        if (this._checkHasBind(target, event, listener, capture))
            return '';

        const eventId = this._eventId;
        target.addEventListener(event, listener, capture);
        this.events.push({
            eventId,
            target,
            event,
            listener,
            capture,
        });

        return eventId;
    }

    /**
     * [detachDOMEvent removeEventListener]
     * @param  {[type]} eventId [unique eventId]
     */
    detachDOMEvent(eventId: string) {
        if (!eventId)
            return false;

        const removeEvent = this.events.find(e => e.eventId === eventId);
        if (removeEvent) {
            const { target, event, listener, capture } = removeEvent;
            target.removeEventListener(event, listener, capture);
            const index = this.events.findIndex(e => e.eventId === eventId);
            this.events.splice(index, 1);
        }
    }

    /**
     * [detachAllDomEvents remove all the DOM events handler]
     */
    detachAllDomEvents() {
        for (const removedEvent of this.events) {
            const { target, event, listener, capture } = removedEvent;
            target.removeEventListener(event, listener, capture);
        }

        this.events = [];
    }

    /**
     * inner method for on and once
     */
    subscribe(event: string, listener: Listener, once = false) {
        const listeners = this.listeners[event];
        const handler = { listener, once };
        if (listeners && Array.isArray(listeners))
            listeners.push(handler);
        else
            this.listeners[event] = [handler];
    }

    /**
     * [on] on custom event
     */
    on(event: string, listener: Listener) {
        this.subscribe(event, listener);
    }

    /**
     * [off] off custom event
     */
    off(event: string, listener: Listener) {
        const listeners = this.listeners[event];
        if (
            Array.isArray(listeners)
            && listeners.some(l => l.listener === listener)
        ) {
            const index = listeners.findIndex(l => l.listener === listener);
            listeners.splice(index, 1);
        }
    }

    /**
     * [once] subscribe event and listen once
     */
    once(event: string, listener: Listener) {
        this.subscribe(event, listener, true);
    }

    /**
     * emit custom event
     */
    emit(event: string, ...data: unknown[]) {
        if (this._suppressionDepth > 0)
            return;

        const buffer = this._eventBuffers.at(-1);
        if (buffer) {
            buffer.push({ event, data });
            return;
        }

        const eventListener = this.listeners[event];

        if (eventListener && Array.isArray(eventListener)) {
            // Snapshot before iterating: a once-listener removes itself via
            // off() during emit, which mutates the same array and causes
            // forEach to skip the adjacent element. Iterate a copy instead.
            const errors: unknown[] = [];
            eventListener.slice().forEach(({ listener, once }) => {
                try {
                    listener(...data);
                }
                catch (error) {
                    errors.push(error);
                }
                finally {
                    if (once)
                        this.off(event, listener);
                }
            });
            if (errors.length === 1)
                throw errors[0];
            if (errors.length > 1) {
                throw new CollectedError(
                    errors,
                    `Multiple ${event} listeners failed.`,
                );
            }
        }
    }

    /** Drop speculative events while a mutation proposal is being prepared. */
    suppress<T>(operation: () => T): T {
        this._suppressionDepth++;
        try {
            return operation();
        }
        finally {
            this._suppressionDepth--;
        }
    }

    /**
     * Capture speculative events and return a one-shot replay boundary. If the
     * operation throws, its buffer is discarded automatically. This lets a
     * prepared state/tree change remain completely unobservable until commit.
     */
    buffer<T>(operation: () => T): { value: T; replay: () => void } {
        const events: IBufferedEvent[] = [];
        this._eventBuffers.push(events);
        let value: T | undefined;
        let operationError: unknown;
        let operationFailed = false;
        try {
            value = operation();
        }
        catch (error) {
            operationFailed = true;
            operationError = error;
        }
        const removed = this._eventBuffers.pop();
        if (removed !== events) {
            const corruption = new TypeError('Event buffer stack was corrupted.');
            if (operationFailed) {
                throw new CollectedError(
                    [operationError, corruption],
                    'Buffered operation failed and corrupted the event stack.',
                );
            }
            throw corruption;
        }
        if (operationFailed)
            throw operationError;

        let replayed = false;
        return {
            value: value as T,
            replay: () => {
                if (replayed)
                    throw new TypeError('Prepared events can only be replayed once.');
                replayed = true;
                const errors: unknown[] = [];
                let lastSelection = -1;
                for (let index = events.length - 1; index >= 0; index--) {
                    if (events[index].event === 'selection-change') {
                        lastSelection = index;
                        break;
                    }
                }
                for (const [index, prepared] of events.entries()) {
                    if (
                        prepared.event === 'selection-change'
                        && index !== lastSelection
                    ) {
                        continue;
                    }
                    try {
                        this.emit(prepared.event, ...prepared.data);
                    }
                    catch (error) {
                        errors.push(error);
                    }
                }
                if (errors.length === 1)
                    throw errors[0];
                if (errors.length > 1) {
                    throw new CollectedError(
                        errors,
                        'Multiple prepared event notifications failed.',
                    );
                }
            },
        };
    }

    /**
     * Remove all pub/sub subscriptions. Called from muya.destroy() to
     * release listener closures so the host page can GC the Muya instance.
     */
    unsubscribeAll() {
        this.listeners = {};
    }

    // Determine whether the event has been bind
    private _checkHasBind(
        cTarget: HTMLElement | Document,
        cEvent: string,
        cListener: EventListenerOrEventListenerObject,
        cCapture?: boolean | AddEventListenerOptions,
    ) {
        for (const { target, event, listener, capture } of this.events) {
            if (
                target === cTarget
                && event === cEvent
                && listener === cListener
                && capture === cCapture
            ) {
                return true;
            }
        }

        return false;
    }
}

export default EventCenter;
