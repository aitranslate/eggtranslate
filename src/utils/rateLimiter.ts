export class RateLimiter {
  private rpm: number;
  private requests: number[];
  private maxQueueSize: number;
  private mutex: Promise<void>;

  constructor(rpm: number = 0) {
    this.rpm = rpm;
    this.requests = [];
    this.maxQueueSize = 1000;
    this.mutex = Promise.resolve();
  }

  canMakeRequest(): boolean {
    if (this.rpm === 0) {
      return true;
    }

    const now = Date.now();
    const windowStart = now - 60 * 1000;

    this.requests = this.requests.filter(time => time > windowStart);

    if (this.requests.length > this.maxQueueSize) {
      this.requests = this.requests.slice(-this.maxQueueSize / 2);
    }

    return this.requests.length < this.rpm;
  }

  async waitForAvailability(): Promise<void> {
    if (this.rpm === 0) {
      return;
    }

    this.mutex = this.mutex.then(async () => {
      while (!this.canMakeRequest()) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      this.requests.push(Date.now());
    });

    await this.mutex;
  }

  setRPM(rpm: number): void {
    this.rpm = rpm;
  }

  getRPM(): number {
    return this.rpm;
  }

  getCurrentRequests(): number {
    if (this.rpm === 0) {
      return 0;
    }

    const now = Date.now();
    const windowStart = now - 60 * 1000;
    this.requests = this.requests.filter(time => time > windowStart);
    return this.requests.length;
  }

  reset(): void {
    this.requests = [];
  }
}

export const rateLimiter = new RateLimiter();