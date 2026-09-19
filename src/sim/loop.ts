/**
 * Fixed-timestep accumulator.
 *
 * The simulation always advances in identical `dt` slices no matter the frame
 * rate, which is what keeps runs deterministic across machines. The renderer
 * gets back `alpha` (0..1) to interpolate between the previous and current
 * physics states so motion still looks smooth.
 */
export class FixedStepper {
  private accumulator = 0;

  constructor(
    public readonly dt = 1 / 120,
    /** Cap so a tab that was backgrounded does not try to catch up forever. */
    private readonly maxStepsPerFrame = 8,
  ) {}

  /** Advance by `frameSeconds` of wall time, calling `step` per fixed slice. */
  advance(frameSeconds: number, step: () => void): number {
    this.accumulator += Math.min(frameSeconds, this.dt * this.maxStepsPerFrame);
    let steps = 0;
    while (this.accumulator >= this.dt && steps < this.maxStepsPerFrame) {
      step();
      this.accumulator -= this.dt;
      steps++;
    }
    // Drop any remaining backlog past the cap rather than spiral.
    if (steps === this.maxStepsPerFrame) this.accumulator = 0;
    return this.accumulator / this.dt;
  }
}
