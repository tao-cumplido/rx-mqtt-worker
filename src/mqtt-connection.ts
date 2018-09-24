import { IClientOptions, IClientPublishOptions, QoS } from 'mqtt';
import {
    MqttPayloadMessage,
    RequestError,
    SharedWorkerConstructor,
    WindowConnectionEvent,
    WindowConnectionWorker,
    WindowSubscriptionWorker,
} from 'mqtt-worker';
import { Observable, Subject } from 'rxjs';
import { share, shareReplay } from 'rxjs/operators';

export interface ObserveOptions {
    qos?: QoS;
    retain?: boolean;
}

declare var SharedWorker: SharedWorkerConstructor;

export class MqttConnection {
    static workerPath = 'mqtt-worker.js';

    private connectionWorker: WindowConnectionWorker;

    private event = {
        error$: new Subject<RequestError>(),
        connect$: new Subject<void>(),
        close$: new Subject<void>(),
        offline$: new Subject<void>(),
    };

    get eventError$(): Observable<RequestError> {
        return this.event.error$;
    }

    get eventConnect$(): Observable<void> {
        return this.event.connect$;
    }

    get eventClose$(): Observable<void> {
        return this.event.close$;
    }

    get eventOffline$(): Observable<void> {
        return this.event.offline$;
    }

    constructor(private name: string, url: string, options?: IClientOptions) {
        this.connectionWorker = new SharedWorker(MqttConnection.workerPath);

        this.connectionWorker.port.onmessage = ({
            data,
        }: WindowConnectionEvent) => {
            switch (data.type) {
                case 'ping':
                    return this.connectionWorker.port.postMessage(data);
                case 'error':
                    return this.event.error$.next(data.error);
                case 'mqtt-connect':
                    return this.event.connect$.next();
                case 'mqtt-close':
                    return this.event.close$.next();
                case 'mqtt-offline':
                    return this.event.offline$.next();
            }
        };

        this.connectionWorker.port.postMessage({
            type: 'connect',
            name,
            url,
            options,
        });
    }

    observe(
        topic: string,
        options?: ObserveOptions
    ): Observable<MqttPayloadMessage> {
        const retain = options && options.retain;
        const clientOptions =
            options && typeof options.qos === 'number'
                ? { qos: options.qos }
                : undefined;

        const source$ = new Subject<MqttPayloadMessage>();

        return new Observable<MqttPayloadMessage>((observer) => {
            const subscription = source$.subscribe(observer);
            const subscriptionWorker: WindowSubscriptionWorker = new SharedWorker(
                MqttConnection.workerPath
            );

            subscriptionWorker.port.onmessage = ({ data }) => {
                switch (data.type) {
                    case 'ping':
                        return subscriptionWorker.port.postMessage(data);
                    case 'error':
                        return source$.error(data.error);
                    case 'mqtt-payload':
                        return source$.next(data);
                }
            };

            subscriptionWorker.port.postMessage({
                type: 'subscribe',
                connection: this.name,
                topic,
                options: clientOptions,
            });

            return () => {
                subscription.unsubscribe();
                subscriptionWorker.port.postMessage({
                    type: 'unsubscribe',
                    connection: this.name,
                    topic,
                });
                subscriptionWorker.port.close();
            };
        }).pipe(retain ? shareReplay(1) : share());
    }

    publish(
        topic: string,
        message: string | Uint8Array,
        options?: IClientPublishOptions
    ): void {
        this.connectionWorker.port.postMessage({
            type: 'publish',
            connection: this.name,
            topic,
            payload: message,
            options,
        });
    }

    close() {
        this.connectionWorker.port.postMessage({
            type: 'close',
            connection: this.name,
        });
        this.connectionWorker.port.close();
    }
}
