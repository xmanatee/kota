
export class FixtureProvenanceError extends Error {
  readonly fixtureDir: string;
  constructor(fixtureDir: string, reason: string) {
    super(`Fixture at "${fixtureDir}" has invalid provenance: ${reason}`);
    this.name = "FixtureProvenanceError";
    this.fixtureDir = fixtureDir;
  }
}

export class FixtureVerifierCalibrationError extends Error {
  readonly fixtureDir: string;
  readonly reason: "missing-required" | "malformed-declaration";

  constructor(
    fixtureDir: string,
    reason: "missing-required" | "malformed-declaration",
    detail: string,
  ) {
    super(`Fixture at "${fixtureDir}" has invalid verifierCalibration: ${detail}`);
    this.name = "FixtureVerifierCalibrationError";
    this.fixtureDir = fixtureDir;
    this.reason = reason;
  }
}

export class FixtureRecordingProvenanceError extends Error {
  readonly fixtureDir: string;
  constructor(fixtureDir: string, reason: string) {
    super(
      `Fixture at "${fixtureDir}" has inconsistent agent-step recording provenance: ${reason}`,
    );
    this.name = "FixtureRecordingProvenanceError";
    this.fixtureDir = fixtureDir;
  }
}
