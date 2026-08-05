export type AppShutdownReason = NodeJS.Signals | 'APPLICATION_CLOSE';

export interface AppShutdownResources {
  beforeClose(reason: AppShutdownReason): void;
  stopPolymarket(): void;
  stopHealthMonitor(): void;
  stopThroughputMonitor(): void;
  closeSubscriptions(): void;
  closeAlertRecorder(): void;
  closeMarketRecorder?: (reason: AppShutdownReason) => Promise<void>;
}

export class AppShutdownCoordinator {
  private shutdownPromise?: Promise<void>;

  public constructor(private readonly resources: AppShutdownResources) {}

  public shutdown(reason: AppShutdownReason): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.closeResources(reason);
    return this.shutdownPromise;
  }

  private async closeResources(reason: AppShutdownReason): Promise<void> {
    let failure: unknown;
    const run = (operation: () => void): void => {
      try {
        operation();
      } catch (error: unknown) {
        failure ??= error;
      }
    };

    run(() => this.resources.beforeClose(reason));
    run(() => this.resources.stopPolymarket());
    run(() => this.resources.stopHealthMonitor());
    run(() => this.resources.stopThroughputMonitor());
    run(() => this.resources.closeSubscriptions());
    run(() => this.resources.closeAlertRecorder());

    try {
      await this.resources.closeMarketRecorder?.(reason);
    } catch (error: unknown) {
      failure ??= error;
    }

    if (failure) {
      throw failure;
    }
  }
}
