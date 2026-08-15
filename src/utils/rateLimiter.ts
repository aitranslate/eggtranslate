class RateLimiter {
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

    this.pruneExpired(windowStart);

    if (this.requests.length > this.maxQueueSize) {
      // 保留最新的 maxQueueSize/2 条（数组按时间单调递增）
      this.requests.splice(0, this.requests.length - Math.floor(this.maxQueueSize / 2));
    }

    return this.requests.length < this.rpm;
  }

  /**
   * 移除窗口外的时间戳。
   * requests 只在 waitForAvailability 的串行 mutex 内 push，时间单调递增，
   * 因此用指针剪裁代替 filter，O(有效长度) 且不分配新数组。
   */
  private pruneExpired(windowStart: number): void {
    let firstValid = 0;
    while (
      firstValid < this.requests.length &&
      this.requests[firstValid] <= windowStart
    ) {
      firstValid += 1;
    }
    if (firstValid > 0) {
      this.requests.splice(0, firstValid);
    }
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
    this.pruneExpired(windowStart);
    return this.requests.length;
  }

  reset(): void {
    this.requests = [];
  }
}

export const rateLimiter = new RateLimiter();